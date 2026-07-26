# Upload Audio Preview Player Design

## Purpose

When a user selects an audio or supported media file in the conversation recording upload control, the app should immediately show a simple player so the user can play, pause, and seek through the selected file before upload.

## Scope

This change applies only to the existing conversation recording file picker in the web app. The preview appears as soon as a file is selected, before the upload action starts. It does not change upload validation, backend processing, generated summary audio playback, or encounter workflow state.

## Recommended Approach

Use `react-h5-audio-player` for the selected-file preview. It provides standard playback controls, current time, duration, and a seek slider while keeping the implementation small.

The native browser object URL for the selected `File` will be passed to the player. When a different file is selected, or when the component unmounts, the old object URL will be revoked to avoid leaking browser memory.

## User Experience

The preview player appears directly below the selected filename in the upload panel. Before a file is selected, no player is shown.

When the user picks another file, the player immediately updates to the new file. The selected file remains uploadable through the existing upload button. The player can remain visible during upload and after upload success because it represents the local file the user selected.

## Components and Data Flow

The existing selected file state remains the source of truth. A derived object URL state is created when `selectedRecordingFile` changes.

Flow:

1. User selects a file in the existing file input.
2. `selectedRecordingFile` updates immediately.
3. A preview URL is created from the selected file.
4. `react-h5-audio-player` renders using that URL.
5. User can play, pause, and seek locally.
6. Upload continues through the existing upload button and API path.

## Error Handling

If no file is selected, no player renders. If the selected file cannot be decoded by the browser, the player will show its normal failed-load behavior; no custom recovery UI is required for this narrow feature.

The preview accepts the same file types already accepted by the upload input, including audio files and supported media containers such as MP4 or WebM where the browser can play the audio track.

## Styling

Use the library's default player behavior with minimal CSS only where needed to fit the existing upload card. The player should be compact and consistent with the current form layout, with no waveform or custom visualization.

## Testing

Add focused web tests that verify:

- Selecting a file immediately renders an audio preview player before upload.
- Replacing the selected file updates the preview source.
- The existing upload button remains available for the selected file.

## Out of Scope

- Waveforms or transcript-linked seeking.
- Upload progress changes.
- Server-side audio validation changes.
- Editing or trimming audio.
- Custom playback controls.
