$basePath = "d:\Work\Crew\prodesk-web\clients\signatures\src"

Get-ChildItem -Path $basePath -Recurse -Include "*.tsx","*.ts" | Where-Object { $_.Name -ne "_fix-colors.ps1" } | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    if ($content -match 'D9F542|c8e030|84cc16') {
        # --- Tailwind className replacements ---
        # bg-[#D9F542]/NN → bg-primary/NN  (with opacity)
        $content = $content -replace 'bg-\[#D9F542\]/(\d+)', 'bg-primary/$1'
        # hover:bg-[#D9F542] → hover:bg-primary
        $content = $content -replace 'hover:bg-\[#D9F542\]', 'hover:bg-primary'
        # hover:bg-[#c8e030] → hover:bg-primary/85
        $content = $content -replace 'hover:bg-\[#c8e030\]', 'hover:bg-primary/85'
        # bg-[#D9F542] → bg-primary (plain, no opacity — must come after opacity variant)
        $content = $content -replace 'bg-\[#D9F542\]', 'bg-primary'
        # text-[#D9F542]/NN → text-primary/NN
        $content = $content -replace 'text-\[#D9F542\]/(\d+)', 'text-primary/$1'
        # text-[#D9F542] → text-primary
        $content = $content -replace 'text-\[#D9F542\]', 'text-primary'
        # border-[#D9F542]/NN → border-primary/NN
        $content = $content -replace 'border-\[#D9F542\]/(\d+)', 'border-primary/$1'
        # border-[#D9F542] → border-primary
        $content = $content -replace 'border-\[#D9F542\]', 'border-primary'

        # --- Inline style / JS string replacements ---
        # '#D9F542' → 'var(--color-primary)' (in JS/style objects)
        $content = $content -replace "'#D9F542'", "'var(--color-primary)'"
        # '#c8e030' → 'var(--color-primary-hover)' — but we'll keep same var
        $content = $content -replace "'#c8e030'", "'var(--color-primary)'"
        # '#84cc16' → 'var(--color-primary)'
        $content = $content -replace "'#84cc16'", "'var(--color-primary)'"

        Set-Content -Path $_.FullName -Value $content -NoNewline
        Write-Output "Updated: $($_.Name)"
    }
}
