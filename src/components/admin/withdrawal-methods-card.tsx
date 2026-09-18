"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Banknote, Check, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

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
import { EmptyState, SectionError, TableSkeleton } from "@/components/admin/shared";
import { WithdrawalMethodLogo } from "@/components/dashboard/withdrawal-method-select";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import type { AdminWithdrawalMethodsResponseDTO, WithdrawalMethodDTO } from "@/lib/types";

/* ================================================================== */
/* Withdrawal Methods manager (admin → Payment Methods page)           */
/*                                                                    */
/* The FIXED set of seven payout channels members pick from in the     */
/* Withdraw page dropdown (EasyPaisa, JazzCash, UPaisa, SadaPay,       */
/* NayaPay, UBL Bank, Bank Al Habib). The admin manages each           */
/* channel's logo image (upload / replace / remove / preview), the     */
/* display order and the enable state — the member dropdown updates    */
/* live. Extends the same image-upload system as the payment-method    */
/* logos and Branding.                                                */
/* ================================================================== */

interface WithdrawalDraft {
  logoUrl: string;
  sortOrder: string;
  isActive: boolean;
}

interface EditorState {
  open: boolean;
  method: WithdrawalMethodDTO | null;
}

function draftFromMethod(m: WithdrawalMethodDTO): WithdrawalDraft {
  return {
    logoUrl: m.logoUrl ?? "",
    sortOrder: String(m.sortOrder),
    isActive: m.isActive,
  };
}

/* ------------------------------------------------------------------ */
/* Edit dialog — logo image, display order, enable state               */
/* ------------------------------------------------------------------ */

function WithdrawalMethodDialog({
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
  const [draft, setDraft] = useState<WithdrawalDraft>(() =>
    state.method ? draftFromMethod(state.method) : { logoUrl: "", sortOrder: "", isActive: true }
  );
  const [errors, setErrors] = useState<{ sortOrder?: string; logoUrl?: string }>({});

  const method = state.method;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving || !method) return;

    const next: { sortOrder?: string; logoUrl?: string } = {};
    const sortOrder = draft.sortOrder.trim();
    if (sortOrder && !/^-?\d+$/.test(sortOrder)) {
      next.sortOrder = "Whole number (lowest shows first).";
    }
    const logoUrl = draft.logoUrl.trim();
    if (
      logoUrl &&
      !logoUrl.startsWith("http://") &&
      !logoUrl.startsWith("https://") &&
      !/^data:image\/(?:png|jpe?g|webp);base64,/.test(logoUrl)
    ) {
      next.logoUrl = "Upload an image or paste an http(s) image URL.";
    }
    setErrors(next);
    if (next.sortOrder || next.logoUrl) return;

    onSave({
      action: "update",
      id: method.id,
      logoUrl,
      ...(sortOrder ? { sortOrder: Number(sortOrder) } : {}),
      isActive: draft.isActive,
    });
  }

  return (
    <Dialog open={state.open} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {method?.name}</DialogTitle>
          <DialogDescription>
            The channel name and type are fixed — manage its logo image, display order and
            availability on the Withdraw page here.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="flex items-center gap-3 rounded-lg border p-3">
            {method ? <WithdrawalMethodLogo method={method} className="size-10" /> : null}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{method?.name}</p>
              <p className="text-xs text-muted-foreground">
                {method?.kind === "bank" ? "Bank Account Number payout field" : "Account / Mobile Number payout field"}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wm-logo">Channel logo (optional)</Label>
            <ImageUploadField
              id="wm-logo"
              value={draft.logoUrl}
              onChange={(v) => {
                setDraft((d) => ({ ...d, logoUrl: v }));
                setErrors((e) => ({ ...e, logoUrl: undefined }));
              }}
              disabled={saving}
              maxDim={256}
              allowUrl
              uploadLabel="Upload image"
              urlLabel="Logo URL (optional)"
              urlPlaceholder="https://example.com/logo.png"
            />
            {errors.logoUrl ? (
              <p className="text-sm text-destructive" role="alert">
                {errors.logoUrl}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Shown inside the Withdraw page dropdown next to the channel name. Remove to restore
                the default icon.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="wm-order">Display order</Label>
            <Input
              id="wm-order"
              value={draft.sortOrder}
              onChange={(e) => {
                setDraft((d) => ({ ...d, sortOrder: e.target.value }));
                setErrors((e2) => ({ ...e2, sortOrder: undefined }));
              }}
              placeholder="auto"
              inputMode="numeric"
              aria-invalid={Boolean(errors.sortOrder)}
            />
            {errors.sortOrder ? (
              <p className="text-sm text-destructive" role="alert">
                {errors.sortOrder}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Lowest number shows first in the dropdown.</p>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Check className="size-4 text-primary" aria-hidden="true" />
              <div>
                <Label htmlFor="wm-active" className="text-sm font-medium">
                  Enabled
                </Label>
                <p className="text-xs text-muted-foreground">
                  Disabled channels disappear from the Withdraw page dropdown.
                </p>
              </div>
            </div>
            <Switch
              id="wm-active"
              checked={draft.isActive}
              onCheckedChange={(v) => setDraft((d) => ({ ...d, isActive: v }))}
              disabled={saving}
              aria-label="Enable withdrawal method"
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
              ) : (
                "Save changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export function WithdrawalMethodsCard() {
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<EditorState>({ open: false, method: null });

  const methodsQuery = useQuery({
    queryKey: ["admin", "withdrawal-methods"],
    queryFn: () => apiFetch<AdminWithdrawalMethodsResponseDTO>("/api/admin/withdrawal-methods"),
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<unknown>("/api/admin/withdrawal-methods", { method: "POST", json: payload }),
    onSuccess: (_data, payload) => {
      const action = String(payload.action ?? "");
      if (action === "toggle") toast("Withdrawal method updated");
      else toast.success("Withdrawal methods saved");
      setEditor((s) => ({ ...s, open: false }));
      void queryClient.invalidateQueries({ queryKey: ["admin", "withdrawal-methods"] });
      void queryClient.invalidateQueries({ queryKey: ["public", "withdrawal-methods"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const methods = methodsQuery.data?.methods ?? [];
  const activeCount = useMemo(() => methods.filter((m) => m.isActive).length, [methods]);

  function move(m: WithdrawalMethodDTO, direction: -1 | 1) {
    const list = [...methods];
    const idx = list.findIndex((x) => x.id === m.id);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return;
    const a = list[idx];
    const b = list[swapIdx];
    list[idx] = b;
    list[swapIdx] = a;
    // Reassign the swapped pair's sort orders (partial update — logo untouched).
    void mutation.mutateAsync({ action: "update", id: a.id, sortOrder: b.sortOrder });
    void mutation.mutateAsync({ action: "update", id: b.id, sortOrder: a.sortOrder });
  }

  return (
    <Card className="overflow-hidden py-0">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Banknote className="size-4 text-primary" aria-hidden="true" />
              Withdrawal Methods
            </CardTitle>
            <CardDescription>
              The payout channels members pick from in the Withdraw page dropdown — upload a logo,
              reorder or disable each channel; changes go live instantly.
            </CardDescription>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="secondary" className="tabular-nums">
            {methods.length} channels
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
          <TableSkeleton rows={5} columns={4} />
        ) : methodsQuery.isError ? (
          <div className="p-6">
            <SectionError
              title="Could not load withdrawal methods"
              message={methodsQuery.error.message}
              onRetry={() => void methodsQuery.refetch()}
            />
          </div>
        ) : methods.length === 0 ? (
          <EmptyState
            icon={Banknote}
            title="No withdrawal channels"
            description="The seven payout channels are seeded automatically — reload this page."
          />
        ) : (
          <ul className="divide-y">
            {methods.map((m, i) => (
              <li
                key={m.id}
                className={cn(
                  "flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-6",
                  !m.isActive && "opacity-60",
                )}
              >
                <WithdrawalMethodLogo method={m} className="size-10" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{m.name}</span>
                    <Badge variant="outline" className="text-[10px] font-semibold uppercase tracking-wide">
                      {m.kind === "bank" ? "Bank" : "Wallet"}
                    </Badge>
                    {m.isActive ? (
                      <Badge className="gap-1.5">
                        <span className="size-1.5 rounded-full bg-primary-foreground" aria-hidden="true" />
                        Enabled
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Disabled</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {m.kind === "bank" ? "Bank Account Number payout field" : "Account / Mobile Number payout field"}
                  </p>
                </div>
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
                <div className="flex items-center gap-1">
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
                    onClick={() => mutation.mutate({ action: "toggle", id: m.id })}
                  >
                    {m.isActive ? "Disable" : "Enable"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <div className="border-t px-4 py-3 sm:px-6">
        <p className="text-xs text-muted-foreground">
          Members pick from these channels in the Withdraw page dropdown (EasyPaisa, JazzCash, UPaisa,
          SadaPay, NayaPay, UBL Bank, Bank Al Habib). Upload a logo to brand each channel; at least
          one channel must stay enabled.
        </p>
      </div>

      {/* Edit dialog */}
      {editor.open ? (
        <WithdrawalMethodDialog
          state={editor}
          saving={mutation.isPending}
          onClose={() => setEditor({ open: false, method: null })}
          onSave={(payload) => mutation.mutate(payload)}
        />
      ) : null}
    </Card>
  );
}
