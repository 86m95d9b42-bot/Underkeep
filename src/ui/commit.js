/**
 * Resolve, commit, then show (`05` section 11: "Every random outcome is
 * written before the result is shown").
 *
 * A screen hands over what the tap does and how to paint what came of it.
 * With the game's saver behind the context, a tap that rolled anything is
 * written to storage before it is painted, and taps that arrive while that
 * write is running are ignored rather than queued behind it. Without one — a
 * test, a tool — it resolves and paints at once, as it always did.
 *
 * @template T
 * @param {{ after?: (resolve: () => T) => Promise<T>, holding?: boolean }} ctx
 * @param {() => T} resolve
 * @param {(result: T) => void} show
 */
export function commitThenShow(ctx, resolve, show) {
  if (typeof ctx?.after !== 'function') {
    show(resolve());
    return;
  }
  if (ctx.holding) return;
  ctx.after(resolve).then(show, (error) => {
    // The game goes on even when storage fails; the saver has already said so.
    console.warn('underkeep: an action could not be committed', error);
  });
}
