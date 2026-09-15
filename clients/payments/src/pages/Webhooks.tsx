import { useState } from "react";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useConfirm } from "@shared/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { sanitizeError } from "@/lib/errorMessage";
import { Plus, RefreshCw, Trash2, Eye, EyeOff, RotateCcw, Zap } from "lucide-react";

const ALL_EVENT_TYPES = [
  "catch_up", "card_update", "skip_requested", "skip_applied",
  "pause_started", "pause_ended", "payout_full",
  "cancel_requested", "cancel_confirmed",
  "defer_requested", "defer_approved", "defer_rejected",
  "vendor_override", "plan_resumed",
] as const;

type EventType = typeof ALL_EVENT_TYPES[number];

function statusBadge(status: string) {
  const map: Record<string, string> = {
    success: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    abandoned: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? map.abandoned}`}>
      {status}
    </span>
  );
}

export default function Webhooks() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const brandId = useBrandId();
  const confirm = useConfirm();
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newFilter, setNewFilter] = useState<EventType[]>([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState<string | null>(null);

  const { data: endpoints = [], isLoading } = useQuery({
    ...trpc.payments.outboundWebhooks.list.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const { data: deliveries = [] } = useQuery({
    ...trpc.payments.outboundWebhooks.deliveries.queryOptions({
      brandId: brandId!,
      endpointId: selectedEndpoint ?? undefined,
      limit: 50,
    }),
    enabled: !!brandId,
  });

  const invalidateList = () =>
    qc.invalidateQueries({ queryKey: trpc.payments.outboundWebhooks.list.queryKey() });

  const createMutation = useMutation({
    ...trpc.payments.outboundWebhooks.create.mutationOptions(),
    onSuccess: () => {
      invalidateList();
      setCreateOpen(false);
      setNewUrl("");
      setNewDesc("");
      setNewFilter([]);
      toast.success("Webhook endpoint created");
    },
    onError: (err) => toast.error(sanitizeError(err)),
  });

  const updateMutation = useMutation({
    ...trpc.payments.outboundWebhooks.update.mutationOptions(),
    onSuccess: () => {
      invalidateList();
      toast.success("Endpoint updated");
    },
    onError: (err) => toast.error(sanitizeError(err)),
  });

  const deleteMutation = useMutation({
    ...trpc.payments.outboundWebhooks.delete.mutationOptions(),
    onSuccess: () => {
      invalidateList();
      toast.success("Endpoint deleted");
    },
    onError: (err) => toast.error(sanitizeError(err)),
  });

  const rotateMutation = useMutation({
    ...trpc.payments.outboundWebhooks.rotateSecret.mutationOptions(),
    onSuccess: () => {
      invalidateList();
      toast.success("Secret rotated — copy it now, it won't be shown again", { duration: 8000 });
    },
    onError: (err) => toast.error(sanitizeError(err)),
  });

  const retryMutation = useMutation({
    ...trpc.payments.outboundWebhooks.retryDelivery.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.payments.outboundWebhooks.deliveries.queryKey() });
      toast.success("Delivery queued for retry");
    },
    onError: (err) => toast.error(sanitizeError(err)),
  });

  const toggleFilter = (type: EventType) => {
    setNewFilter((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  return (
    <div className="container py-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Outbound Webhooks</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Receive real-time lifecycle events at your HTTP endpoints. Payloads are signed with HMAC-SHA256.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Endpoint
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Webhook Endpoint</DialogTitle>
              <DialogDescription>
                EziQuotes will POST lifecycle events to this URL. The URL must use HTTPS.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label>Endpoint URL</Label>
                <Input
                  placeholder="https://your-server.com/webhooks/eziquotes"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Description (optional)</Label>
                <Input
                  placeholder="e.g. Production CRM integration"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Event Filter (leave empty to receive all events)</Label>
                <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto border rounded-md p-2">
                  {ALL_EVENT_TYPES.map((type) => (
                    <label key={type} className="flex items-center gap-2 cursor-pointer text-sm">
                      <Checkbox
                        checked={newFilter.includes(type)}
                        onCheckedChange={() => toggleFilter(type)}
                      />
                      <span className="font-mono text-xs">{type}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                onClick={() =>
                  createMutation.mutate({
                    brandId: brandId!,
                    url: newUrl,
                    description: newDesc || undefined,
                    eventFilter: newFilter.length > 0 ? newFilter : undefined,
                  })
                }
                disabled={!newUrl || createMutation.isPending || !brandId}
              >
                {createMutation.isPending ? "Creating..." : "Create Endpoint"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="endpoints">
        <TabsList>
          <TabsTrigger value="endpoints">Endpoints ({endpoints.length})</TabsTrigger>
          <TabsTrigger value="deliveries">Delivery Log</TabsTrigger>
        </TabsList>

        <TabsContent value="endpoints" className="mt-4">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading...</div>
          ) : endpoints.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Zap className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                <p className="text-muted-foreground">No webhook endpoints configured.</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Add an endpoint to start receiving lifecycle events.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {endpoints.map((ep: any) => (
                <Card key={ep.id} className={!ep.enabled ? "opacity-60" : ""}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-sm font-mono truncate">{ep.url}</CardTitle>
                          <Badge variant={ep.enabled ? "default" : "secondary"}>
                            {ep.enabled ? "Active" : "Disabled"}
                          </Badge>
                        </div>
                        {ep.description && (
                          <CardDescription className="mt-0.5">{ep.description}</CardDescription>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Switch
                          checked={ep.enabled}
                          onCheckedChange={(checked) =>
                            updateMutation.mutate({ id: ep.id, enabled: checked })
                          }
                          title={ep.enabled ? "Disable endpoint" : "Enable endpoint"}
                        />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    {/* Signing secret */}
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Signing Secret</Label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs bg-muted px-2 py-1 rounded font-mono truncate">
                          {showSecret[ep.id] ? ep.secret : "whs_••••••••••••••••••••••••••••••••••••••••••••••••"}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() =>
                            setShowSecret((prev) => ({ ...prev, [ep.id]: !prev[ep.id] }))
                          }
                        >
                          {showSecret[ep.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Rotate secret"
                          onClick={async () => {
                            if (await confirm({
                              title: "Rotate the signing secret?",
                              description: "Existing integrations will break until updated.",
                              confirmLabel: "Rotate secret",
                              destructive: true,
                            })) {
                              rotateMutation.mutate({ id: ep.id });
                            }
                          }}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Event filter */}
                    {ep.eventFilter && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Subscribed Events</Label>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {ep.eventFilter.split(",").map((t: string) => (
                            <Badge key={t} variant="outline" className="text-xs font-mono">
                              {t.trim()}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {!ep.eventFilter && (
                      <p className="text-xs text-muted-foreground">Subscribed to all events</p>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                        onClick={() => setSelectedEndpoint(ep.id === selectedEndpoint ? null : ep.id)}
                      >
                        <RefreshCw className="h-3 w-3 mr-1" />
                        {ep.id === selectedEndpoint ? "Hide deliveries" : "View deliveries"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive text-xs"
                        onClick={async () => {
                          if (await confirm({ title: "Delete this endpoint?", destructive: true, confirmLabel: "Delete" })) {
                            deleteMutation.mutate({ id: ep.id });
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="deliveries" className="mt-4">
          {selectedEndpoint && (
            <p className="text-sm text-muted-foreground mb-3">
              Showing deliveries for endpoint {selectedEndpoint.slice(0, 8)}.{" "}
              <button className="underline" onClick={() => setSelectedEndpoint(null)}>
                Show all
              </button>
            </p>
          )}
          {deliveries.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">No deliveries yet.</p>
              </CardContent>
            </Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>HTTP</TableHead>
                  <TableHead>Attempt</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((d: any) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs">{d.eventType}</TableCell>
                    <TableCell>{statusBadge(d.status)}</TableCell>
                    <TableCell className="text-sm">{d.httpStatus ?? "—"}</TableCell>
                    <TableCell className="text-sm">{d.attempt}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(d.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {(d.status === "failed" || d.status === "abandoned") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => retryMutation.mutate({ deliveryId: d.id })}
                        >
                          Retry
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>

      {/* Verification guide */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-sm">Verifying Webhook Signatures</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto">{`// Node.js example
const crypto = require('crypto');

function verifySignature(secret, body, signature) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
}

// In your Express handler:
app.post('/webhooks/eziquotes', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-eziquotes-signature'];
  if (!verifySignature(YOUR_SECRET, req.body, sig)) {
    return res.status(401).send('Invalid signature');
  }
  const event = JSON.parse(req.body);
  console.log('Event:', event.event, event.data);
  res.json({ ok: true });
});`}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
