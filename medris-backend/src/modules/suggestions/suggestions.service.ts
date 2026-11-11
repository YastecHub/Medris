import type { DataContext, Identity } from "../../database/context.js";
import { AccessRepository } from "../../database/repositories/access.repository.js";
import { SuggestionsRepository } from "../../database/repositories/suggestions.repository.js";
import { badRequest, forbidden, notFound } from "../../shared/errors/app-error.js";
import type { Suggestion } from "./suggestions.schemas.js";
import { isSqlBlank } from "../../lib/sql-text.js";
import { NotificationWriter } from "../../database/repositories/notification-writer.repository.js";

/** The suggestion box: anyone can write to a shop or to Levromart; the shop / admins read it. */
export class SuggestionsService {
  constructor(private readonly db: () => DataContext) {}

  /** Replaces: public.submit_suggestion(text, uuid, text, boolean) - returns the new id. */
  async submit(
    me: Identity | null,
    input: { targetType: string; targetVendorId?: string | null; message?: string | null; isAnonymous?: boolean | null },
  ): Promise<{ id: string }> {
    if (isSqlBlank(input.message)) throw badRequest("Message is required.");
    if (input.targetType === "vendor" && !input.targetVendorId) throw badRequest("A vendor must be specified.");
    const create = (repo: SuggestionsRepository) =>
      repo.create(me?.userId ?? null, input.targetType, input.targetVendorId ?? null, input.message!, input.isAnonymous ?? false);
    // Signed in: on the sender's behalf (triggers see them). Signed out: anonymous, as before.
    const id = me
      ? await this.db().onBehalfOf(me, (tx) => create(new SuggestionsRepository(tx)))
      : await this.db().asService((tx) => create(new SuggestionsRepository(tx)));
    return { id };
  }

  /** Replaces: public.get_vendor_suggestions() - suggestions sent to the caller's shop. */
  vendorSuggestions(me: Identity | null): Promise<Suggestion[]> {
    return this.db().asService(async (tx) => {
      const vendorId = await new AccessRepository(tx).liveVendorIdOf(me?.userId);
      if (!vendorId) throw notFound("No vendor profile found.");
      return new SuggestionsRepository(tx).list({ vendorId });
    });
  }

  /** Replaces: public.get_platform_suggestions() - admins only. */
  platformSuggestions(me: Identity | null): Promise<Suggestion[]> {
    return this.db().asService(async (tx) => {
      if (!(await new AccessRepository(tx).isAdmin(me?.userId))) throw forbidden("Admins only.");
      return new SuggestionsRepository(tx).list("platform");
    });
  }

  /** Replaces: public.mark_suggestion_read(uuid) - the receiving shop, or an admin for platform suggestions. */
  async markRead(me: Identity | null, suggestionId: string): Promise<{ done: true }> {
    await this.db().asService(async (tx) => {
      const repo = new SuggestionsRepository(tx);
      const access = new AccessRepository(tx);
      const row = await repo.find(suggestionId);
      if (!row) throw notFound("Not found.");
      if (row.target_type === "platform") {
        if (!(await access.isAdmin(me?.userId))) throw forbidden("Not allowed.");
      } else {
        const vendorId = await access.liveVendorIdOf(me?.userId);
        if (!vendorId || vendorId !== row.target_vendor_id) throw forbidden("Not allowed.");
      }
      await repo.markRead(suggestionId);
    });
    return { done: true };
  }

  /** Edit your reply to a suggestion (the sender's notification is updated too). */
  async editReply(me: Identity | null, suggestionId: string, message: string | null | undefined): Promise<{ success: true }> {
    const text = (message ?? "").trim();
    if (text === "") throw badRequest("Write your reply first.");
    if (text.length > 2000) throw badRequest("That reply is too long.");
    return this.ownReply(me, suggestionId, async (repo, row) => {
      await repo.editReply(suggestionId, text);
      const nid = row.sender_id ? await repo.replyNotificationId(row.sender_id, quote(row.message)) : null;
      if (nid) await repo.updateNotificationBody(nid, `You wrote: "${quote(row.message)}"\nReply: ${text}`);
    });
  }

  /** Delete your reply: the suggestion goes back to "not replied" and the sender's reply notification is removed. */
  async deleteReply(me: Identity | null, suggestionId: string): Promise<{ success: true }> {
    return this.ownReply(me, suggestionId, async (repo, row) => {
      const nid = row.sender_id ? await repo.replyNotificationId(row.sender_id, quote(row.message)) : null;
      await repo.clearReply(suggestionId);
      if (nid) await repo.hideNotification(nid);
    });
  }

  private async ownReply(me: Identity | null, suggestionId: string, run: (repo: SuggestionsRepository, row: { sender_id: string | null; message: string }) => Promise<void>): Promise<{ success: true }> {
    if (!me) throw forbidden("Authentication required.");
    await this.db().asService(async (tx) => {
      const repo = new SuggestionsRepository(tx);
      const access = new AccessRepository(tx);
      const row = await repo.find(suggestionId);
      if (!row) throw notFound("Not found.");
      if (row.target_type === "platform") {
        if (!(await access.isAdmin(me.userId))) throw forbidden("Not allowed.");
      } else {
        const vendorId = await access.liveVendorIdOf(me.userId);
        if (!vendorId || vendorId !== row.target_vendor_id) throw forbidden("Not allowed.");
      }
      if (row.reply_message == null) throw badRequest("There is no reply to change.");
      await run(repo, row);
    });
    return { success: true };
  }


  /**
   * Replaces: public.reply_to_suggestion(uuid, text) - the shop the suggestion went to (or an admin, for Levromart) answers once; the
   * sender is told through a notification, so an anonymous sender stays anonymous.
   */
  async reply(me: Identity | null, suggestionId: string, message: string | null | undefined): Promise<{ success: true }> {
    if (!me) throw forbidden("Authentication required.");
    const text = (message ?? "").trim();
    if (text === "") throw badRequest("Write your reply first.");
    if (text.length > 2000) throw badRequest("That reply is too long.");
    await this.db().asService(async (tx) => {
      const repo = new SuggestionsRepository(tx);
      const access = new AccessRepository(tx);
      const row = await repo.find(suggestionId);
      if (!row) throw notFound("Not found.");
      let name = "Levromart";
      if (row.target_type === "platform") {
        if (!(await access.isAdmin(me.userId))) throw forbidden("Not allowed.");
      } else {
        const vendorId = await access.liveVendorIdOf(me.userId);
        if (!vendorId || vendorId !== row.target_vendor_id) throw forbidden("Not allowed.");
        name = (await repo.shopName(vendorId)) ?? "A shop";
      }
      if (row.reply_message != null) throw badRequest("You have already replied to this suggestion.");
      await repo.setReply(suggestionId, text, me.userId);
      const quoted = row.message.length > 140 ? `${row.message.slice(0, 140)}...` : row.message;
      await new NotificationWriter(tx).create({
        userId: row.sender_id,
        type: "suggestion_reply",
        title: `${name} replied to your suggestion`,
        body: `You wrote: "${quoted}"\nReply: ${text}`,
        targetView: row.target_type === "vendor" ? "storefront" : null,
        targetParams: row.target_type === "vendor" ? { vendorId: row.target_vendor_id } : null,
        actorId: null,
      });
    });
    return { success: true };
  }
}

const quote = (m: string) => (m.length > 140 ? `${m.slice(0, 140)}...` : m);
