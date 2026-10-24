/**
 * Save a lead's follow-up date from the browser. Online only, like the menu it
 * came from: follow-up is a lead field, not part of the offline knock queue.
 *
 * Returns whether the server accepted it, so the caller decides what to say.
 */
export async function saveFollowUpDate(leadId: string, followUpDate: string | null): Promise<boolean> {
  try {
    const res = await fetch(`/api/admin/leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ follow_up_date: followUpDate }),
    });
    const data = await res.json().catch(() => null);
    return Boolean(res.ok && data?.success);
  } catch {
    return false;
  }
}
