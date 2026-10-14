# Final Moradon E2E rerun request

Triggered after the final WS04/WS05 native framebuffer orchestration fix.

Provider sync:
- WS04 current capture head: `32616b1b7ccbdc3de41c0949f182a65e03450d18`
- WS05 synchronized head: `0537c481383a69c534799b43810f35e7279c5578`
- Moradon world proof request id `1010` is now Present-only: timer fallback cannot invoke DumpFramePPM during asset preload; the next genuine RHIDeviceGL::Present() services the request.
- WS10 browser driver remains armed before sustained world rendering so JS/native starvation cannot lose the request.

Run the real create -> select -> Moradon native framebuffer gate and record PASS/BLOCKED with the first true blocker only.
