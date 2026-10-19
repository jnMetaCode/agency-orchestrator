/**
 * 运行的事件缓冲：让 Studio 的运行不再和某一个浏览器连接同生共死。
 *
 * 以前 /api/run 的 SSE 响应一断（刷新、关标签、网络抖一下）服务端就 SIGTERM 子进程——
 * 按秒计费的视频还在服务商那边跑，用户这边的运行却没了。现在每个运行一份缓冲：
 * 连接只是订阅者，断开 = 退订；重新打开页面后从头重放，界面按同样的事件重建出来。
 *
 * 体积有上限：超出时只丢最早的原始终端输出（stdout/stderr——结构化事件里已经有一份），
 * 步骤头、正文、状态这些重建界面要用的事件一条不丢。运行结束后再留一会儿，刚跑完就刷新也看得到结果。
 */

const RAW = new Set(['stdout', 'stderr']);

class RunStream {
  constructor(id, meta, limits, onExpire) {
    this.id = id;
    this.meta = meta;
    this.limits = limits;
    this.onExpire = onExpire;
    this.events = [];
    this.seq = 0;
    this.rawChars = 0;
    this.droppedRaw = 0;
    this.subscribers = new Set();
    this.done = false;
    this.endedAt = undefined;
    this.cancelRequested = false;
  }

  push(type, data) {
    if (this.done) return this.seq;
    const event = { seq: ++this.seq, type, data };
    this.events.push(event);
    if (RAW.has(type)) {
      this.rawChars += String(data?.text ?? '').length;
      this.trim();
    }
    for (const sub of this.subscribers) sub.send(type, data);
    return event.seq;
  }

  trim() {
    if (this.rawChars <= this.limits.maxRawChars) return;
    const kept = [];
    for (const event of this.events) {
      if (this.rawChars > this.limits.maxRawChars && RAW.has(event.type)) {
        this.rawChars -= String(event.data?.text ?? '').length;
        this.droppedRaw++;
        continue;
      }
      kept.push(event);
    }
    this.events = kept;
  }

  /** 先补发 seq > after 的事件，再接实时；运行已结束则补发完就收口。返回退订函数。 */
  subscribe(sub, after = 0) {
    if (this.droppedRaw > 0 && after === 0) {
      sub.send('stderr', { text: `（较早的 ${this.droppedRaw} 段终端输出因体积上限已省略，步骤内容完整）\n` });
    }
    for (const event of this.events) if (event.seq > after) sub.send(event.type, event.data);
    if (this.done) { sub.end(); return () => {}; }
    this.subscribers.add(sub);
    return () => { this.subscribers.delete(sub); };
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.endedAt = this.limits.now();
    for (const sub of this.subscribers) sub.end();
    this.subscribers.clear();
    const timer = this.limits.setTimer(() => this.onExpire(this.id), this.limits.retainMs);
    timer?.unref?.();
  }
}

export class RunStreamHub {
  constructor({ maxRawChars = 2_000_000, retainMs = 10 * 60_000, now = Date.now, setTimer = setTimeout } = {}) {
    this.limits = { maxRawChars, retainMs, now, setTimer };
    this.streams = new Map();
  }

  create(id, meta = {}) {
    const stream = new RunStream(id, { ...meta, startedAt: meta.startedAt ?? this.limits.now() }, this.limits,
      (expired) => { if (this.streams.get(expired) === stream) this.streams.delete(expired); });
    this.streams.set(id, stream);
    return stream;
  }

  get(id) { return this.streams.get(id); }

  /** 只列出这个服务进程里还在内存中的运行——重启之后的旧运行不在这里，去「我的运行」看存档 */
  list() {
    return [...this.streams.values()].map(s => ({
      runId: s.id, title: s.meta.title, startedAt: s.meta.startedAt, done: s.done, endedAt: s.endedAt,
      cancelRequested: s.cancelRequested,
    }));
  }
}

/** 把一个 express 响应包装成订阅者（SSE 帧格式与 /api/run 原来的一致） */
export function sseSubscriber(res) {
  return {
    send(type, data) {
      if (res.writableEnded) return;
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    end() { if (!res.writableEnded) res.end(); },
  };
}
