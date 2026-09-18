"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CreditCard,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, SectionError, TableSkeleton, TableWrap } from "@/components/admin/shared";
import { MethodVisual } from "@/components/dashboard/payment-methods";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { WithdrawalMethodsCard } from "@/components/admin/withdrawal-methods-card";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import type { PaymentMethodDTO } from "@/lib/types";

interface MethodsPayload {
  methods: PaymentMethodDTO[];
}

interface MethodDraft {
  name: string;
  accountNumber: string;
  accountTitle: string;
  instructions: string;
  logoUrl: string;
  sortOrder: string;
  isActive: boolean;
}

const EMPTY_DRAFT: MethodDraft = {
  name: "",
  accountNumber: "",
  accountTitle: "",
  instructions: "",
  logoUrl: "",
  sortOrder: "",
  isActive: true,
};

function draftFromMethod(m: PaymentMethodDTO): MethodDraft {
  return {
    name: m.name,
    accountNumber: m.accountNumber,
    accountTitle: m.accountTitle ?? "",
    instructions: m.instructions ?? "",
    logoUrl: m.logoUrl ?? "",
    sortOrder: String(m.sortOrder),
    isActive: m.isActive,
  };
}

/* ------------------------------------------------------------------ */
/* Create / edit dialog                                                */
/* ------------------------------------------------------------------ */

interface EditorState {
  open: boolean;
  method: PaymentMethodDTO | null; // null = create
}

function MethodDialog({
  state,
  onClose,
  onSave,
  saving,
}: {
  state: EditorState;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<MethodDraft>(() =>
    state.method ? draftFromMethod(state.method) : EMPTY_DRAFT
  );
  const [errors, setErrors] = useState<Partial<Record<keyof MethodDraft, string>>>({});

  const editing = state.method !== null;

  function set<K extends keyof MethodDraft>(key: K, value: MethodDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;

    const next: Partial<Record<keyof MethodDraft, string>> = {};
    const name = draft.name.trim();
    if (name.length < 2 || name.length > 40) next.name = "Name must be 2–40 characters.";
    const accountNumber = draft.accountNumber.trim();
    if (accountNumber.length < 4 || accountNumber.length > 100) {
      next.accountNumber = "Account number must be 4–100 characters.";
    }
    if (draft.accountTitle.trim().length > 60) next.accountTitle = "At most 60 characters.";
    if (draft.instructions.trim().length > 400) next.instructions = "At most 400 characters.";
    const logoUrl = draft.logoUrl.trim();
    if (
      logoUrl &&
      !logoUrl.startsWith("http://") &&
      !logoUrl.startsWith("https://") &&
      !/^data:image\/(?:png|jpe?g|webp);base64,/.test(logoUrl)
    ) {
      next.logoUrl = "Upload an image or paste an http(s) image URL.";
    }
    if (draft.sortOrder.trim() && !/^-?\d+$/.test(draft.sortOrder.trim())) {
      next.sortOrder = "Whole number (lowest shows first).";
    }
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    onSave({
      action: editing ? "update" : "create",
      ...(editing && state.method ? { id: state.method.id } : {}),
      name,
      accountNumber,
      accountTitle: draft.accountTitle.trim(),
      instructions: draft.instructions.trim(),
      logoUrl,
      ...(draft.sortOrder.trim() ? { sortOrder: Number(draft.sortOrder.trim()) } : {}),
      isActive: draft.isActive,
    });
  }

  return (
    <Dialog open={state.open} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing && state.method ? `Edit ${state.method.name}` : "Add payment method"}</DialogTitle>
          <DialogDescription>
            Every value here renders live on the member checkout pages — nothing is hardcoded.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pm-name">Method name</Label>
              <Input
                id="pm-name"
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. EasyPaisa"
                aria-invalid={Boolean(errors.name)}
              />
              {errors.name ? (
                <p className="text-sm text-destructive" role="alert">
                  {errors.name}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="pm-order">Display order</Label>
              <Input
                id="pm-order"
                value={draft.sortOrder}
                onChange={(e) => set("sortOrder", e.target.value)}
                placeholder="auto"
                inputMode="numeric"
                aria-invalid={Boolean(errors.sortOrder)}
              />
              {errors.sortOrder ? (
                <p className="text-sm text-destructive" role="alert">
                  {errors.sortOrder}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Lowest number shows first.</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pm-number">Account number / wallet address</Label>
            <Input
              id="pm-number"
              value={draft.accountNumber}
              onChange={(e) => set("accountNumber", e.target.value)}
              placeholder="03XXXXXXXXX"
              className="font-mono"
              aria-invalid={Boolean(errors.accountNumber)}
            />
            {errors.accountNumber ? (
              <p className="text-sm text-destructive" role="alert">
                {errors.accountNumber}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pm-title">Account title</Label>
            <Input
              id="pm-title"
              value={draft.accountTitle}
              onChange={(e) => set("accountTitle", e.target.value)}
              placeholder="e.g. Task Reward Payments"
              aria-invalid={Boolean(errors.accountTitle)}
            />
            {errors.accountTitle ? (
              <p className="text-sm text-destructive" role="alert">
                {errors.accountTitle}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Shown above the account number with its own copy button.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pm-logo">Method image / QR (optional)</Label>
            <ImageUploadField
              id="pm-logo"
              value={draft.logoUrl}
              onChange={(v) => set("logoUrl", v)}
              disabled={saving}
              maxDim={256}
              allowUrl
              uploadLabel="Upload image"
              urlLabel="Image / QR URL (optional)"
              urlPlaceholder="https://example.com/qr.png"
            />
            {errors.logoUrl ? (
              <p className="text-sm text-destructive" role="alert">
                {errors.logoUrl}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Replaces the icon on every member checkout; crypto methods show it as a scannable
                QR. Remove to restore the default icon.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pm-instructions">Payment instructions (optional)</Label>
            <Textarea
              id="pm-instructions"
              value={draft.instructions}
              rows={3}
              maxLength={400}
              onChange={(e) => set("instructions", e.target.value)}
              placeholder="e.g. Send from your EasyPaisa app, then paste the TID from the receipt."
              aria-invalid={Boolean(errors.instructions)}
            />
            {errors.instructions ? (
              <p className="text-sm text-destructive" role="alert">
                {errors.instructions}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Check className="size-4 text-primary" aria-hidden="true" />
              <div>
                <Label htmlFor="pm-active" className="text-sm font-medium">
                  Enabled
                </Label>
                <p className="text-xs text-muted-foreground">
                  Disabled methods stay stored but disappear from checkout.
                </p>
              </div>
            </div>
            <Switch
              id="pm-active"
              checked={draft.isActive}
              onCheckedChange={(v) => set("isActive", v)}
              disabled={saving}
              aria-label="Enable payment method"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : editing ? (
                "Save changes"
              ) : (
                "Add method"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export function PaymentMethodsView() {
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<EditorState>({ open: false, method: null });
  const [deleteTarget, setDeleteTarget] = useState<PaymentMethodDTO | null>(null);

  const methodsQuery = useQuery({
    queryKey: ["admin", "payment-methods"],
    queryFn: () => apiFetch<MethodsPayload>("/api/admin/payment-methods"),
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<unknown>("/api/admin/payment-methods", { method: "POST", json: payload }),
    onSuccess: (_data, payload) => {
      const action = String(payload.action ?? "");
      if (action === "delete") toast("Payment method deleted");
      else if (action === "toggle") toast("Payment method updated");
      else toast.success("Payment methods saved");
      setEditor((s) => ({ ...s, open: false }));
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "payment-methods"] });
      void queryClient.invalidateQueries({ queryKey: ["public", "payment-methods"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const methods = methodsQuery.data?.methods ?? [];
  const activeCount = useMemo(() => methods.filter((m) => m.isActive).length, [methods]);

  function move(m: PaymentMethodDTO, direction: -1 | 1) {
    const list = [...methods];
    const idx = list.findIndex((x) => x.id === m.id);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return;
    const a = list[idx];
    const b = list[swapIdx];
    list[idx] = b;
    list[swapIdx] = a;
    // Reassign sequential sort orders for the swapped pair.
    void mutation.mutateAsync({
      action: "update",
      id: a.id,
      name: a.name,
      accountNumber: a.accountNumber,
      accountTitle: a.accountTitle ?? "",
      instructions: a.instructions ?? "",
      logoUrl: a.logoUrl ?? "",
      sortOrder: b.sortOrder,
    });
    void mutation.mutateAsync({
      action: "update",
      id: b.id,
      name: b.name,
      accountNumber: b.accountNumber,
      accountTitle: b.accountTitle ?? "",
      instructions: b.instructions ?? "",
      logoUrl: b.logoUrl ?? "",
      sortOrder: a.sortOrder,
    });
  }

  return (
    <div className="space-y-6">
      {/* Header card */}
      <Card className="overflow-hidden py-0">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="size-4 text-primary" aria-hidden="true" />
                Payment Methods
              </CardTitle>
              <CardDescription>
                The payment channels members see at checkout — add, edit, order, enable or disable
                them here; changes go live instantly.
              </CardDescription>
            </div>
            <Button
              type="button"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => setEditor({ open: true, method: null })}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add method
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant="secondary" className="tabular-nums">
              {methods.length} total
            </Badge>
            <Badge className="gap-1.5 tabular-nums">
              <span
                className="size-1.5 animate-pulse rounded-full bg-primary-foreground"
                aria-hidden="true"
              />
              {activeCount} enabled
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {methodsQuery.isPending ? (
            <TableSkeleton rows={4} columns={4} />
          ) : methodsQuery.isError ? (
            <div className="p-6">
              <SectionError
                title="Could not load payment methods"
                message={methodsQuery.error.message}
                onRetry={() => void methodsQuery.refetch()}
              />
            </div>
          ) : methods.length === 0 ? (
            <EmptyState
              icon={Landmark}
              title="No payment methods yet"
              description="Add your first payment channel — members will see it on every checkout page."
            />
          ) : (
            <TableWrap>
              <table className="min-w-[860px]">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="pl-6 pr-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Method
                    </th>
                    <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Account number
                    </th>
                    <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Account title
                    </th>
                    <th className="hidden px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground lg:table-cell">
                      Instructions
                    </th>
                    <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Order
                    </th>
                    <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Status
                    </th>
                    <th className="pr-6 pl-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {methods.map((m, i) => (
                    <tr key={m.id} className={cn(!m.isActive && "opacity-60")}>
                      <td className="pl-6 pr-3 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <MethodVisual method={m} />
                          </span>
                          <span className="text-sm font-medium">{m.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="block max-w-[190px] truncate font-mono text-xs" title={m.accountNumber}>
                          {m.accountNumber}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {m.accountTitle ? (
                          <span className="block max-w-[160px] truncate text-sm" title={m.accountTitle}>
                            {m.accountTitle}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="hidden px-3 py-3 lg:table-cell">
                        {m.instructions ? (
                          <span className="block max-w-[220px] truncate text-xs text-muted-foreground" title={m.instructions}>
                            {m.instructions}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            disabled={mutation.isPending || i === 0}
                            aria-label={`Move ${m.name} up`}
                            onClick={() => move(m, -1)}
                          >
                            <ArrowUp className="size-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            disabled={mutation.isPending || i === methods.length - 1}
                            aria-label={`Move ${m.name} down`}
                            onClick={() => move(m, 1)}
                          >
                            <ArrowDown className="size-3.5" aria-hidden="true" />
                          </Button>
                          <span className="w-6 text-center text-xs tabular-nums text-muted-foreground">
                            {m.sortOrder}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {m.isActive ? (
                          <Badge className="gap-1.5">
                            <span className="size-1.5 rounded-full bg-primary-foreground" aria-hidden="true" />
                            Enabled
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Disabled</Badge>
                        )}
                      </td>
                      <td className="pr-6 pl-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1.5"
                            disabled={mutation.isPending}
                            onClick={() => setEditor({ open: true, method: m })}
                          >
                            <Pencil className="size-3.5" aria-hidden="true" />
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled={mutation.isPending}
                            onClick={() =>
                              mutation.mutate({ action: "toggle", id: m.id })
                            }
                          >
                            {m.isActive ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={mutation.isPending}
                            aria-label={`Delete ${m.name}`}
                            onClick={() => setDeleteTarget(m)}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Members pick from these methods on the Packages checkout, VIP plan checkout and the wallet
        deposit form. At least one method must stay enabled.
      </p>

      {/* Withdrawal Methods — the admin-managed Withdraw page dropdown channels */}
      <WithdrawalMethodsCard />

      {/* Create / edit dialog */}
      {editor.open ? (
        <MethodDialog
          state={editor}
          saving={mutation.isPending}
          onClose={() => setEditor({ open: false, method: null })}
          onSave={(payload) => mutation.mutate(payload)}
        />
      ) : null}

      {/* Delete confirm */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && !mutation.isPending && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The method disappears from every checkout page immediately. Existing payment requests
              keep their recorded method name — nothing is lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={mutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) mutation.mutate({ action: "delete", id: deleteTarget.id });
              }}
            >
              {mutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
