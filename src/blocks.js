import { supabase } from "./supabase";

// Returns a Set of parent_ids that are hidden from the current user — both
// people the user blocked AND people who blocked the user (two-directional),
// without revealing which is which. Backed by the hidden_parent_ids() RPC.
// Call once per screen load and use the Set to filter any people lists.
export async function getHiddenParentIds() {
  try {
    const { data, error } = await supabase.rpc("hidden_parent_ids");
    if (error || !data) return new Set();
    return new Set(data.map((row) => (typeof row === "string" ? row : row.hidden_parent_ids)).filter(Boolean));
  } catch (e) {
    return new Set();
  }
}

// Block a parent: records the block and severs any existing connection between
// the two (either direction), plus clears pending connection requests.
export async function blockParent(myParentId, targetParentId) {
  // 1) Record the block (idempotent via unique constraint).
  const { error: blockErr } = await supabase.from("blocks").insert({
    blocker_id: myParentId,
    blocked_id: targetParentId,
  });
  if (blockErr && !String(blockErr.message || "").toLowerCase().includes("duplicate")) {
    return { ok: false, error: blockErr.message };
  }

  // 2) Sever any connection between us (either direction).
  try {
    await supabase
      .from("connections")
      .delete()
      .or(
        `and(requester_id.eq.${myParentId},recipient_id.eq.${targetParentId}),` +
        `and(requester_id.eq.${targetParentId},recipient_id.eq.${myParentId})`
      );
  } catch (e) { /* best-effort */ }

  return { ok: true };
}

// Unblock a parent.
export async function unblockParent(myParentId, targetParentId) {
  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("blocker_id", myParentId)
    .eq("blocked_id", targetParentId);
  return { ok: !error, error: error?.message };
}

// The list of parents THIS user has blocked (for a "Blocked families" settings list).
export async function getMyBlockedList(myParentId) {
  try {
    const { data } = await supabase
      .from("blocks")
      .select("blocked_id, created_at, parents:parents!blocks_blocked_id_fkey(id, name, photo_url)")
      .eq("blocker_id", myParentId)
      .order("created_at", { ascending: false });
    return (data || []).map((r) => ({
      parentId: r.blocked_id,
      name: r.parents?.name || "A parent",
      photo_url: r.parents?.photo_url || null,
      blockedAt: r.created_at,
    }));
  } catch (e) {
    return [];
  }
}