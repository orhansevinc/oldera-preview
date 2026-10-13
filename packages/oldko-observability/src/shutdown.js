export function createShutdownController(options = {}) {
  const {
    logger,
    timeoutMs = 10_000,
    onDraining,
    hooks = []
  } = options;

  let running;

  async function run(signal = 'manual') {
    if (running) return running;

    running = (async () => {
      onDraining?.(true, signal);
      logger?.info?.('shutdown_started', { signal });

      const timeout = new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
        timer.unref?.();
      });

      const work = (async () => {
        const results = [];
        for (const hook of hooks) {
          const name = hook.name || 'anonymous_hook';
          try {
            await hook(signal);
            results.push({ name, ok: true });
          } catch (error) {
            logger?.error?.('shutdown_hook_failed', { signal, hook: name, error });
            results.push({ name, ok: false, error: error?.message ?? String(error) });
          }
        }
        return { timedOut: false, results };
      })();

      const result = await Promise.race([work, timeout]);
      if (result.timedOut) logger?.error?.('shutdown_timeout', { signal, timeout_ms: timeoutMs });
      else logger?.info?.('shutdown_completed', { signal, results: result.results });
      return result;
    })();

    return running;
  }

  return Object.freeze({ run, isRunning: () => Boolean(running) });
}

export function installGracefulShutdown(options) {
  const {
    signals = ['SIGTERM', 'SIGINT'],
    exit = true,
    exitCode = 0,
    ...controllerOptions
  } = options ?? {};

  const controller = createShutdownController(controllerOptions);
  const listeners = new Map();

  for (const signal of signals) {
    const listener = async () => {
      const result = await controller.run(signal);
      if (exit) {
        process.exitCode = result.timedOut ? 1 : exitCode;
        process.exit();
      }
    };
    listeners.set(signal, listener);
    process.on(signal, listener);
  }

  return Object.freeze({
    controller,
    dispose() {
      for (const [signal, listener] of listeners) process.off(signal, listener);
      listeners.clear();
    }
  });
}
