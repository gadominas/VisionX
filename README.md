# VisionX

**Your iPhone as a smart camera, built with [Scriptable](https://scriptable.app).** VisionX takes a photo every few seconds, has an AI model (OpenAI or Apple Intelligence) look at it with your own instructions, and keeps a live summary of what it sees. When something you care about happens, it runs an Apple Shortcut, so it can open a gate, send a notification or switch on a light.

<p align="center">
  <img src="docs/screenshots/gate.png" width="260" alt="A car at the gate: the plate is read and the Open Gate shortcut runs">
  &nbsp;
  <img src="docs/screenshots/count.png" width="260" alt="Counting distinct vehicles and their plates over a session">
  &nbsp;
  <img src="docs/screenshots/triggers.png" width="260" alt="Editing a trigger that runs a shortcut">
</p>
<p align="center"><sub>Left: a known plate is read and the "Open Gate" shortcut runs. Middle: counting vehicles and plates over a session. Right: setting up triggers.<br>Screenshots of the app's real interface, rendered with a drawn test scene in place of the camera.</sub></p>

## Install

1. Get **[Scriptable](https://apps.apple.com/app/scriptable/id1405459188)** (free) on your iPhone.
2. In Scriptable, tap **+**, paste these two lines, name the script *VisionX Installer*, and tap **▶**:
   ```js
   const code = await new Request("https://raw.githubusercontent.com/gadominas/VisionX/main/install.js").loadString();
   await eval("(async () => {" + code + "\n})()");
   ```
3. Tap **Open VisionX**. On first run, paste an OpenAI API key (kept in the iOS Keychain) or choose **Use Apple Intelligence only**. You can change the key later in the app.

**Update:** run *VisionX Installer* again. Presets, triggers and settings are kept.

**Rather not use the loader?** Paste [`install.js`](install.js) or [`VisionX.js`](VisionX.js) into a new script yourself.

## What it does

- **Timed capture.** It takes a photo every N seconds from the live camera, with no tapping.
- **Your instructions.** It does whatever you describe, such as "Count the different people and summarize them" or "Read the license plate of any car at the gate". Save instructions you like as presets.
- **Latest photo next to the summary.** The newest photo is large, with the summary beside it. The two photos before it are shown smaller, and that's all: photos are never saved.
- **Two summary modes.** Each photo can build on one running summary for the whole session, or be judged fresh on its own (see [Modes](#modes)).
- **Triggers.** A trigger has a plain-language condition, such as "A car with plate KXA 482 is at the gate", and a shortcut to run. When the model says the condition is met, the shortcut runs with the summary text as its input. Live rows show which triggers are waiting, checking or have fired, and each one can be switched on or off at any time.
- **Session stats.** At the end you see the duration, photos taken, requests sent, tokens used, and how many times each trigger fired.
- **OpenAI or Apple Intelligence.** Use any image-capable OpenAI model from your account, or Apple Intelligence through Shortcuts with no API key.

## Use cases

**Open the gate for a known car.** Point the phone at the driveway and use fresh mode with the instruction "Read the license plate of any car at the gate". Add a trigger "A car with plate KXA 482 or LMN 215 is at the gate" that runs a shortcut controlling your HomeKit gate or garage door, and a second trigger for unknown plates that just notifies you. Use "Each time it becomes true" so the gate opens once per arrival, not on every photo.

> A license plate is not proof of identity, because plates can be copied or misread. Use this for convenience together with other safeguards, not as the only lock.

**Count cars and plates.** At a parking entrance, keep "Build up over the session" on and ask it to count distinct vehicles and list their plates. The model tracks each vehicle, so the same car isn't counted twice. A "Lot is full" trigger can close a barrier or switch a sign once more than N cars have entered.

**Count plates in a kitchen.** Aim it at the pass and ask it to count plated dishes going out, grouped by dish. At the end of service you have a tally without anyone keeping notes.

**Know when the delivery arrives.** "A courier or a delivery van is at the door" can trigger a notification, a doorbell chime on a HomePod, or unlocking a parcel box.

**Room and event headcount.** "Count the different people in the room" with a trigger at a capacity limit for meeting rooms, classrooms or small events.

**Safety checks.** "Someone is working at the bench without safety glasses", or "The stove is on and nobody is in the kitchen", can trigger an alert.

**Shelf and stock watch.** "Any shelf section is empty" can trigger a restock reminder in Reminders.

**Wildlife and pets.** Count species at a bird feeder over a morning, or get a notification when the dog is on the sofa.

## How to use it

1. Open **What to look for**, write your instructions (or pick a preset) and set how often to take a photo.
2. Choose **Analyze with**: OpenAI (pick a model) or Apple Intelligence.
3. Optional: open **Triggers** and add one or more.
4. Tap **Start session**, then **End session** to see the stats.

Keep the app in the foreground with the screen on during a session; set Auto-Lock to Never for long ones.

### Modes

The **Build up over the session** switch controls whether photos add to one summary or stand alone.

| | On (default) | Off (fresh for each photo) |
|---|---|---|
| Summary | Running summary of everything seen in the session | Only what the latest photo shows ("Right now") |
| Each request includes | The new photo and the summary so far | Only the new photo |
| Triggers are checked | On their own timer (every N seconds), against the summary | With every photo, inside the same request, at no extra cost |
| Best for | Counting and tallies over time | Catching a moment as it happens |

### Triggers

Each trigger has a name, a condition, the shortcut to run, and when to run it:

- **Each time it becomes true** (default): runs once, then waits until the condition is false again.
- **Only the first time**: runs at most once per session.
- **Every check while true**: runs on every check where the condition is met.

The shortcut receives the summary text as its **Shortcut Input**. For example, a shortcut can use *Show Notification* with Shortcut Input, or *Control Home* to open a gate. Running a shortcut briefly switches to the Shortcuts app and back, and only one shortcut runs at a time.

## Apple Intelligence setup

Scriptable can't call Apple Intelligence directly, so VisionX runs a shortcut that uses the **Use Model** action. Choose the cloud model (Private Cloud Compute), because the on-device model may not accept images.

**Vision Session AI** analyzes photos:
1. **Take Photo**, with *Show Camera Preview* turned off.
2. **Resize Image**, width 768.
3. **Copy to Clipboard**, with the resized image.
4. **Use Model** (cloud). In the prompt, insert *Shortcut Input*, then the *Resized Image*.
5. **Stop and Output**, with the model's *Response*.

Run it once from Shortcuts to grant camera access. With Apple Intelligence, each photo briefly opens Shortcuts. VisionX reads the photo from the clipboard and clears it straight away.

**Vision Session Check** checks triggers. It's only needed with Apple Intelligence when "Build up over the session" is on:
1. **Use Model** (cloud), with *Shortcut Input* as the prompt.
2. **Stop and Output**, with the model's *Response*.

Both shortcut names can be changed in the app.

## Privacy

- Photos are kept in memory only, and only the last three. They are never written to disk or Photos.
- Each photo is sent to the model you choose, either OpenAI or Apple's Private Cloud Compute. OpenAI requests are sent with `store: false`.
- The OpenAI API key stays in the iOS Keychain.
- Presets, triggers and settings are saved in Scriptable's local Documents folder as `vision-session.json`.

## Notes

- OpenAI calls go through Scriptable's native networking, using the Responses API. If a model rejects an optional setting, VisionX drops it and retries.
- Token counts are shown for OpenAI. Apple doesn't report them.
- How well it reads plates, counts and judges conditions depends on the model, the light and the camera angle. Test a setup before relying on it.
