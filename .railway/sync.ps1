# Push variables to Railway services based on each service's .env file
# Runs all services IN PARALLEL and batches variable sets into single CLI calls

param(
    [ValidateSet("development", "staging", "production")]
    [string]$Env = "development"
)

# Map: Railway service name to its env file (subdirectory\filename, .env appended)
# All frontends share the single client\client.env — one env file for every frontend.
$serviceMap = @{
    "Prodesk backend" = "server\backend"
    "Worker"          = "server\backend"
    "Redirector"      = "server\redirector"
    "Dashboard"       = "client\client"
    "Prodesk"         = "client\client"
    "Links"           = "client\client"
    "Reviews"         = "client\client"
    "Payments"        = "client\client"
    "Signatures"      = "client\client"
    "Jobs"            = "client\client"
    "Websites"        = "client\client"
    "Design"          = "client\client"
    "Logo"            = "client\client"
    "Passwords"       = "client\client"
    "Chat"            = "client\client"
}

$envsDir = ".\.railway\envs"
$sharedAllFile = Join-Path $envsDir "shared.env"
$sharedEnvFile = Join-Path $envsDir "shared.$Env.env"

# Get project ID from linked project (needed for parallel jobs)
$statusOutput = railway status 2>&1
$projectId = ($statusOutput | Select-String "Project ID:\s+(.+)" | ForEach-Object { $_.Matches[0].Groups[1].Value }).Trim()
if (-not $projectId) {
    Write-Host "Error: No linked Railway project. Run 'railway link' first." -ForegroundColor Red
    exit 1
}

# Helper: parse an .env file into a hashtable
function Parse-EnvFile($filePath) {
    $result = @{}
    if (-not (Test-Path $filePath)) { return $result }
    foreach ($rawLine in (Get-Content $filePath)) {
        $trimmed = $rawLine.Trim()
        if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }
        $eqIdx = $trimmed.IndexOf('=')
        if ($eqIdx -lt 1) { continue }
        $key = $trimmed.Substring(0, $eqIdx)
        $value = $trimmed.Substring($eqIdx + 1).Trim('"').Trim("'")
        $result[$key] = $value
    }
    return $result
}

# Load shared variables: shared.env (all environments) + shared.<env>.env (environment-specific)
$sharedAll = Parse-EnvFile $sharedAllFile
$sharedPerEnv = Parse-EnvFile $sharedEnvFile

# Merge: environment-specific wins over all-environment
$shared = @{}
foreach ($kv in $sharedAll.GetEnumerator()) { $shared[$kv.Key] = $kv.Value }
foreach ($kv in $sharedPerEnv.GetEnumerator()) { $shared[$kv.Key] = $kv.Value }

$sharedRefPattern = [regex]'^\$\{\{shared\.(.+)\}\}$'

Write-Host "`n=== Railway Variable Sync ($Env) ===" -ForegroundColor Cyan
Write-Host "Project: $projectId" -ForegroundColor DarkGray
Write-Host "Shared vars: $($sharedAll.Count) (all envs) + $($sharedPerEnv.Count) ($Env) = $($shared.Count) total" -ForegroundColor Cyan
Write-Host ""

# Build work items and launch parallel jobs
$jobs = @()

foreach ($railwayName in $serviceMap.Keys) {
    $svcFile = $serviceMap[$railwayName]
    $filePath = Join-Path $envsDir "$svcFile.env"

    if (-not (Test-Path $filePath)) {
        Write-Host ">>> $railwayName - no env file, skipping" -ForegroundColor Yellow
        continue
    }

    # Parse service env file and resolve shared refs
    $vars = @()
    foreach ($rawLine in (Get-Content $filePath)) {
        $trimmed = $rawLine.Trim()
        if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }
        $eqIdx = $trimmed.IndexOf('=')
        if ($eqIdx -lt 1) { continue }
        $key = $trimmed.Substring(0, $eqIdx)
        $rawValue = $trimmed.Substring($eqIdx + 1).Trim('"').Trim("'")

        $match = $sharedRefPattern.Match($rawValue)
        if ($match.Success) {
            $sharedKey = $match.Groups[1].Value
            if ($shared.ContainsKey($sharedKey)) {
                $resolvedValue = $shared[$sharedKey]
            } else {
                Write-Host "  !! $key does not exist... skipping silently" -ForegroundColor Yellow
                continue
            }
        } else {
            # Direct value — pass through as-is (supports Railway refs like Redis.REDIS_URL)
            $resolvedValue = $rawValue
        }

        # An empty value must NOT be forwarded: `railway variable set KEY=` is
        # rejected as "Invalid variable format", and because every variable goes up
        # in ONE batched call that single rejection fails the WHOLE service. An
        # optional var declared empty (e.g. EMAIL_ALLOWED_ORIGINS="" outside prod)
        # simply shouldn't be set — dropping it here also keeps it out of
        # $desiredKeys, so a stale value already on the service gets removed.
        if ([string]::IsNullOrWhiteSpace($resolvedValue)) {
            Write-Host "  ~~ $key is empty - not setting" -ForegroundColor DarkYellow
            continue
        }
        $vars += @{ Key = $key; Raw = "${key}=${resolvedValue}" }
    }

    if ($vars.Count -eq 0) { continue }

    $desiredKeys = @($vars | ForEach-Object { $_.Key })
    $varArgs = @($vars | ForEach-Object { $_.Raw })

    Write-Host ">>> $railwayName ($($vars.Count) vars) - started" -ForegroundColor Green

    # Launch parallel job
    $job = Start-Job -ScriptBlock {
        param($svcName, $envName, $projId, $desiredKeys, $varArgs)

        $log = @()

        # Step 1: Delete extras
        $currentJson = railway variable list -s $svcName -e $envName -p $projId --json 2>&1
        if ($LASTEXITCODE -eq 0 -and $currentJson) {
            try {
                $currentVars = $currentJson | ConvertFrom-Json
                $currentKeys = $currentVars.PSObject.Properties.Name
                foreach ($existingKey in $currentKeys) {
                    if ($existingKey -like "RAILWAY_*") { continue }
                    if ($existingKey -notin $desiredKeys) {
                        railway variable delete $existingKey -s $svcName -e $envName -p $projId 2>&1 | Out-Null
                        $log += "  x  $existingKey REMOVED"
                    }
                }
            } catch {
                $log += "  !! Failed to parse current vars"
            }
        }

        # Step 2: Set all variables in ONE call
        $setResult = & railway variable set @varArgs -s $svcName -e $envName -p $projId --skip-deploys 2>&1
        $setOk = $LASTEXITCODE -eq 0
        # A service that does not exist on Railway yet is a PROVISIONING gap, not a
        # bad variable state — it is reported and skipped, but does not fail the run
        # the way a genuine set failure does.
        $missing = -not $setOk -and "$setResult" -match "not found"
        if ($setOk) {
            $log += "  -> SET $($varArgs.Count) variables OK"
        } elseif ($missing) {
            $log += "  -> SKIPPED: service does not exist on Railway yet"
        } else {
            $log += "  -> SET FAILED: $setResult"
        }

        return @{ Service = $svcName; Log = $log; Count = $varArgs.Count; SetOk = $setOk; Missing = $missing }
    } -ArgumentList $railwayName, $Env, $projectId, $desiredKeys, $varArgs

    $jobs += @{ Job = $job; Name = $railwayName }
}

# Wait for all jobs
Write-Host "`nWaiting for all services..." -ForegroundColor DarkGray

$syncedOk = @()
$syncFailed = @()

foreach ($j in $jobs) {
    $result = Receive-Job -Job $j.Job -Wait -AutoRemoveJob
    Write-Host "`n>>> $($result.Service)" -ForegroundColor Green
    foreach ($line in $result.Log) {
        if ($line -match "REMOVED") {
            Write-Host $line -ForegroundColor DarkRed
        } elseif ($line -match "OK") {
            Write-Host $line -ForegroundColor Yellow
        } else {
            Write-Host $line -ForegroundColor Red
        }
    }
    if ($result.SetOk) { $syncedOk += $result.Service } else { $syncFailed += $result.Service }
}

Write-Host "`n=== Sync complete ===" -ForegroundColor Cyan

# Step 3: Redeploy — ONLY services whose variables actually landed. Redeploying a
# service whose SET failed would boot it on a known-bad variable state, which is
# the opposite of what this script is for; leave it on its last good deploy and
# let the operator fix the cause and re-run.
if ($syncFailed.Count -gt 0) {
    Write-Host "`nNOT deploying (variable sync failed): $($syncFailed -join ', ')" -ForegroundColor Red
}

if ($syncedOk.Count -eq 0) {
    Write-Host "`nNo services synced successfully - nothing to deploy." -ForegroundColor Red
    exit 1
}

Write-Host "`nDeploying all services..." -ForegroundColor Cyan

$allServiceNames = $syncedOk
$deployJobs = @()

foreach ($svcName in $allServiceNames) {
    $deployJob = Start-Job -ScriptBlock {
        param($svc, $envName, $projId)
        $output = railway redeploy -s $svc -e $envName -p $projId -y 2>&1
        return @{ Service = $svc; Output = "$output"; ExitCode = $LASTEXITCODE }
    } -ArgumentList $svcName, $Env, $projectId
    $deployJobs += $deployJob
    Write-Host "  -> $svcName - deploy triggered" -ForegroundColor Yellow
}

foreach ($dj in $deployJobs) {
    $result = Receive-Job -Job $dj -Wait -AutoRemoveJob
    if ($result.ExitCode -eq 0) {
        Write-Host "  -> $($result.Service) - deployed" -ForegroundColor Green
    } else {
        Write-Host "  -> $($result.Service) - FAIL: $($result.Output)" -ForegroundColor Red
    }
}

if ($syncFailed.Count -gt 0) {
    Write-Host "`n=== Done, WITH FAILURES ===" -ForegroundColor Red
    Write-Host "Not synced or deployed: $($syncFailed -join ', ')" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== All done ===" -ForegroundColor Cyan
