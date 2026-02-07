export function createTaskQueue(options = {}) {
  const concurrency = Math.max(1, Number(options.concurrency || 3));
  const delayMs = Math.max(0, Number(options.delayMs || 120));

  const pending = [];
  let activeCount = 0;
  let nextStartAt = 0;
  let timerId = null;

  function schedulePump(delay) {
    if (timerId !== null) {
      return;
    }

    timerId = setTimeout(() => {
      timerId = null;
      pump();
    }, delay);
  }

  function pump() {
    if (pending.length === 0 || activeCount >= concurrency) {
      return;
    }

    const now = Date.now();
    const wait = Math.max(0, nextStartAt - now);
    if (wait > 0) {
      schedulePump(wait);
      return;
    }

    const next = pending.shift();
    activeCount += 1;
    nextStartAt = Date.now() + delayMs;

    Promise.resolve()
      .then(() => next.task())
      .then(next.resolve)
      .catch(next.reject)
      .finally(() => {
        activeCount -= 1;
        pump();
      });

    if (activeCount < concurrency && pending.length > 0) {
      pump();
    }
  }

  function enqueue(task) {
    if (typeof task !== "function") {
      return Promise.reject(new Error("Queue task must be a function"));
    }

    return new Promise((resolve, reject) => {
      pending.push({ task, resolve, reject });
      pump();
    });
  }

  return {
    enqueue,
    getState() {
      return {
        concurrency,
        delayMs,
        activeCount,
        pendingCount: pending.length,
      };
    },
  };
}
