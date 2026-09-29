// A browser-level pin for leaving the media preflight: the way back to the
// lobby, and the devices it has to give back on the way.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RUNTIME_CONFIG,
  launchChromium,
  startStaticServer,
} from "./source.js";

let browser = null;
let server = null;
let base = "";

before(async () => {
  browser = await launchChromium();
  if (!browser) return;
  ({ server, base } = await startStaticServer({
    runtimeConfig: DEFAULT_RUNTIME_CONFIG,
  }));
});

after(async () => {
  await browser?.close();
  await new Promise((closed) => (server ? server.close(closed) : closed()));
});

/// Stands in for the camera and microphone, and writes every grant and every
/// explicit `stop()` to sessionStorage. The page unloading releases a real
/// device without calling `stop()`, so a track found stopped here was stopped
/// by the page, and sessionStorage is what survives the navigation to the
/// lobby to be read afterwards.
///
/// The first camera request is held until `window.releaseCamera()` answers it,
/// which is how a test hands the page a grant that lands after the candidate
/// has already left. It returns the id of the track it granted.
function fakeMedia() {
  const log = (key, id) => {
    const seen = JSON.parse(sessionStorage.getItem(key) || "[]");
    seen.push(id);
    sessionStorage.setItem(key, JSON.stringify(seen));
  };
  const trackFor = (kind) => {
    if (kind === "audio") {
      return new AudioContext()
        .createMediaStreamDestination()
        .stream.getAudioTracks()[0];
    }
    const canvas = document.createElement("canvas");
    canvas.getContext("2d").fillRect(0, 0, 1, 1);
    return canvas.captureStream().getVideoTracks()[0];
  };
  const grant = (constraints) => {
    const stream = new MediaStream();
    for (const kind of ["audio", "video"]) {
      if (!constraints?.[kind]) continue;
      const track = trackFor(kind);
      const stop = track.stop.bind(track);
      track.stop = () => {
        log("stopped", track.id);
        stop();
      };
      log("granted", `${kind}:${track.id}`);
      stream.addTrack(track);
    }
    return stream;
  };
  let holdCamera = true;
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    if (!constraints?.video || !holdCamera) return grant(constraints);
    holdCamera = false;
    return new Promise((resolve) => {
      window.releaseCamera = () => {
        const stream = grant(constraints);
        resolve(stream);
        return stream.getVideoTracks()[0].id;
      };
    });
  };
}

const readLog = (page) =>
  page.evaluate(() => ({
    granted: JSON.parse(sessionStorage.getItem("granted") || "[]"),
    stopped: JSON.parse(sessionStorage.getItem("stopped") || "[]"),
  }));

test("the preflight's way back returns to the lobby and stops every device it holds", async (t) => {
  if (!browser) {
    t.skip("playwright chromium unavailable");
    return;
  }
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // The lobby is held back so the preflight is still the page when the late
  // camera grant arrives; a grant that lands after the unload proves nothing.
  let letLobbyLoad;
  const lobbyHeld = new Promise((resolve) => (letLobbyLoad = resolve));
  await page.route(`${base}/`, async (route) => {
    await lobbyHeld;
    await route.continue();
  });
  try {
    await page.addInitScript(fakeMedia);
    await page.goto(`${base}/interview.html?problem=chargeback-pair-match`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () =>
        typeof window.releaseCamera === "function" &&
        JSON.parse(sessionStorage.getItem("granted") || "[]").some((grant) =>
          grant.startsWith("audio:"),
        ),
    );

    // Leaving is not gated on the checks it abandons.
    assert.equal(await page.locator("#audio-check-join").isDisabled(), true);
    assert.equal(await page.locator("#audio-check-leave").isEnabled(), true);

    const held = await readLog(page);
    const live = held.granted
      .map((grant) => grant.slice(grant.indexOf(":") + 1))
      .filter((id) => !held.stopped.includes(id));
    assert.ok(
      live.length > 0,
      `nothing held to release: ${JSON.stringify(held)}`,
    );

    // One evaluate for both, in this order. Playwright will not evaluate in a
    // page whose navigation has started, so the grant cannot follow the click
    // as a second call.
    const late = await page.evaluate(() => {
      document.querySelector("#audio-check-leave").click();
      return window.releaseCamera();
    });
    letLobbyLoad();
    await page.waitForURL(`${base}/`);

    const { stopped } = await readLog(page);
    assert.deepEqual(
      live.filter((id) => !stopped.includes(id)),
      [],
      "every track the preflight held was stopped before the page left",
    );
    assert.ok(
      stopped.includes(late),
      "a camera granted after leaving was kept rather than stopped",
    );
    assert.deepEqual(errors, [], `leaving threw in the browser: ${errors[0]}`);
  } finally {
    await page.close();
  }
});
