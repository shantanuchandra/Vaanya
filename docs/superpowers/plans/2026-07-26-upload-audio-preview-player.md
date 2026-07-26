# Upload Audio Preview Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a playable, seekable audio preview immediately after a user selects a conversation recording file.

**Architecture:** Keep `selectedRecordingFile` as the source of truth in `apps/web/src/App.tsx`. Derive a browser object URL from that file, render `react-h5-audio-player` below the selected filename, and revoke stale object URLs on replacement or unmount.

**Tech Stack:** React 19, Vite, Vitest, Testing Library, `react-h5-audio-player`.

## Global Constraints

- Preview appears as soon as a file is selected, before the upload action starts.
- Do not change upload validation, backend processing, generated summary audio playback, or encounter workflow state.
- Use `react-h5-audio-player` for standard playback controls, duration, current time, and seek slider.
- Revoke old browser object URLs when a different file is selected or when the component unmounts.
- Keep styling minimal and consistent with the existing upload card; no waveform or custom visualization.

---

### Task 1: Selected Recording Preview Player

**Files:**
- Modify: `apps/web/package.json`
- Modify: `package-lock.json`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: existing `selectedRecordingFile: File | null` state in `App`.
- Produces: `selectedRecordingPreviewUrl: string | null`, rendered through `<AudioPlayer src={selectedRecordingPreviewUrl} />`.

- [ ] **Step 1: Install the audio player dependency**

Run:

```bash
npm install react-h5-audio-player --workspace apps/web
```

Expected: `apps/web/package.json` lists `react-h5-audio-player`, and `package-lock.json` is updated.

- [ ] **Step 2: Write the failing preview tests**

Add a local mock near the imports in `apps/web/src/App.test.tsx` so tests can assert the library receives a preview URL without depending on the third-party DOM:

```tsx
vi.mock("react-h5-audio-player", () => ({
  default: ({ src }: { src?: string }) => (
    <audio aria-label="Preview selected conversation audio" data-testid="selected-recording-preview" controls src={src} />
  )
}));
```

Add a test inside `describe("PAC review workspace", () => { ... })`:

```tsx
  it("previews the selected conversation recording immediately before upload", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn((file: Blob) => `blob:preview-${(file as File).name}`);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => demoEncounter
      }))
    );

    render(<App />);

    const input = await screen.findByLabelText(/conversation recording file/i);
    const firstFile = new File(["first audio"], "first-pac.mp3", { type: "audio/mpeg" });

    await user.upload(input, firstFile);

    const preview = screen.getByLabelText("Preview selected conversation audio");
    expect(preview).toHaveAttribute("src", "blob:preview-first-pac.mp3");
    expect(screen.getByText("first-pac.mp3")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /upload selected conversation/i })
    ).toBeInTheDocument();

    const secondFile = new File(["second audio"], "second-pac.wav", { type: "audio/wav" });
    await user.upload(input, secondFile);

    expect(screen.getByLabelText("Preview selected conversation audio")).toHaveAttribute(
      "src",
      "blob:preview-second-pac.wav"
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview-first-pac.mp3");
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
npm test --workspace apps/web -- App.test.tsx
```

Expected: FAIL because `react-h5-audio-player` is not imported/rendered or preview URL state does not exist yet.

- [ ] **Step 4: Implement preview URL state and player rendering**

In `apps/web/src/App.tsx`, add imports:

```tsx
import AudioPlayer from "react-h5-audio-player";
import "react-h5-audio-player/lib/styles.css";
```

Add state next to `selectedRecordingFile`:

```tsx
  const [selectedRecordingPreviewUrl, setSelectedRecordingPreviewUrl] =
    useState<string | null>(null);
```

Add this effect after the existing effects:

```tsx
  useEffect(() => {
    if (!selectedRecordingFile) {
      setSelectedRecordingPreviewUrl(null);
      return;
    }

    const previewUrl = URL.createObjectURL(selectedRecordingFile);
    setSelectedRecordingPreviewUrl(previewUrl);

    return () => URL.revokeObjectURL(previewUrl);
  }, [selectedRecordingFile]);
```

Render the player below the selected filename in the file picker:

```tsx
              {selectedRecordingFile ? (
                <span>{selectedRecordingFile.name}</span>
              ) : null}
              {selectedRecordingPreviewUrl ? (
                <div className="selected-recording-preview">
                  <AudioPlayer
                    src={selectedRecordingPreviewUrl}
                    showJumpControls={false}
                    customAdditionalControls={[]}
                    customVolumeControls={[]}
                    layout="horizontal"
                  />
                </div>
              ) : null}
```

- [ ] **Step 5: Add minimal layout CSS**

In `apps/web/src/styles.css`, near the `.recording-actions` styles, add:

```css
.selected-recording-preview {
  margin-top: 10px;
  width: min(420px, 100%);
}

.selected-recording-preview .rhap_container {
  box-shadow: none;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 8px;
  padding: 8px 10px;
}
```

- [ ] **Step 6: Run focused verification**

Run:

```bash
npm test --workspace apps/web -- App.test.tsx
npm run typecheck --workspace apps/web
```

Expected: both commands pass.

- [ ] **Step 7: Commit implementation**

Run:

```bash
git add apps/web/package.json package-lock.json apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/styles.css docs/superpowers/plans/2026-07-26-upload-audio-preview-player.md
git commit -m "Add selected upload audio preview"
```
