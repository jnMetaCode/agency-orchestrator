/** Per-question, in-memory claim. No answers or prompts are written to the job registry. */
export function claimInput(stream, child, body) {
  const fail = (status, code, error) => ({ status, code, error });
  if (!body.inputRequestId || !body.stepId) return fail(400, 'INPUT_REQUEST_REQUIRED', '请刷新 Studio 后回答当前问题');
  if (!child || child.killed || child.exitCode !== null || child.signalCode !== null
    || !child.stdin?.writable || stream?.cancelRequested || stream?.done) {
    return fail(409, 'INPUT_NOT_WAITING', '运行已结束或正在取消');
  }
  const pending = stream?.pendingInput;
  if (!pending || pending.inputRequestId !== body.inputRequestId || pending.stepId !== body.stepId) {
    return fail(409, 'INPUT_STALE', '问题已过期或回答已提交，请查看当前运行状态');
  }
  if (typeof body.text !== 'string' || Buffer.byteLength(body.text) > 64 * 1024) {
    return fail(400, 'INPUT_INVALID', '回答必须是文本，且不能超过 64 KiB');
  }
  stream.pendingInput = null;
  return { frame: JSON.stringify({ stepId: body.stepId, inputRequestId: body.inputRequestId, text: body.text }) + '\n' };
}
