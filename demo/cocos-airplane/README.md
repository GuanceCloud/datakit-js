# Cocos Creator Airplane Replay Demo

This is a browser build of the Cocos team's open-source 3D airplane tutorial,
instrumented for Guance Session Replay WebGL acceptance.

- Upstream: <https://github.com/cocos/cocos-tutorial-airplane>
- Pinned commit: `2aa02adc51144327a163356f019a77560eb04460`
- License: MIT (see `LICENSE`)
- Cocos Creator: 3.3.2
- Build target: Web Mobile, debug build

The Replay SDK, Canvas configuration, and `webglReplayPlugin()` are initialized
in `replay-bootstrap.js` before the Cocos SystemJS entry imports the engine.
This ordering is intentional because game engines may cache WebGL draw methods
during boot.

Run the repository dev server and open:

```text
http://127.0.0.1:8082/cocos-airplane/index.html
```

The query parameter `sampling=1|2|4` selects a 2, 4, or 8 FPS WebGL capture
target. Add `fresh=1` to expire the previous local RUM session and start a clean
recording session. Click the game canvas to start; hold and drag to move the
plane and fire. Add `diagnose=1` only when inspecting the first 2.5 seconds of
DOM/Canvas mutation summaries; it stays out of normal recordings.

Add `clarity=high` for a clarity-first acceptance recording. This profile uses
2 FPS capture, raises the continuous WebGL snapshot to about the live display
resolution, and increases the per-frame encoded-byte ceiling. It intentionally
trades capture frequency and upload volume for sharper Replay output.

The generated Cocos build is kept in this directory so acceptance does not
require the 3.3.2 editor. To regenerate it, build the pinned upstream project as
Web Mobile with Cocos Creator 3.3.2, then reapply `index.html`, `style.css`,
`replay-bootstrap.js`, and the small debug hook in `application.js`.
