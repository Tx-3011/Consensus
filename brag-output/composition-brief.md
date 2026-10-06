# Hyperframes Composition Brief: Consensus Trap

## Objective
Create a short launch-style brag video for Consensus Trap, a research workbench that compares answer surfaces and traces citations without inventing a consensus or truth score.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape - 1920x1080
- Duration: 22.93 seconds

## Source Material
- Project root: `C:\Users\iamte\Desktop\desktop\Projects\Consensus`
- Primary files read: `README.md`, `package.json`, `src/components/InvestigationWorkbench.tsx`, `src/app/globals.css`, `src/server/adapters/search/fixtures.ts`, `docs/capabilities.md`, `docs/demo.md`
- Product name: Consensus Trap
- Tagline / strongest claim: `Search surfaces are witnesses, not votes`
- Key UI or visual moment to recreate: the split question/results workbench, followed by claim comparison and the saved evidence map
- Copy that must appear verbatim:
  - `What survives the citation trail?`
  - `Collect answers`
  - `A citation is not an inspected source.`
  - `Observed agreement is not a truth score.`
  - `Every relationship must remain tied to inspectable evidence.`

## Creative Direction
- Tone preset: polished
- Creative direction: forensic research desk with editorial restraint
- Interpretation: Serious, specific, and quietly skeptical. The motion should feel like a research instrument coming online, not a generic SaaS launch.
- Angle: Start with the product's question, show the real entry-to-result flow, then reveal that citations must be inspected before relationships are drawn.
- Hook: `Search surfaces are witnesses, not votes` above `What survives the citation trail?`
- Outro / punchline: `Observed agreement is not a truth score.`
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign
  - Invented accuracy percentages, truth scores, or live research findings

## Visual Identity
- Background: `#101313`
- Text: `#e7e4da`
- Accent: `#e6a75e`
- Display font: Georgia, serif
- Body font: Arial, Helvetica, sans-serif
- Visual references from the project: amber wordmark, thin dark rules, split workbench, answer cards, green evidence markers, serif editorial headings

## Storyboard
Use the storyboard in `brag-plan.md` as the creative contract.

Scene summary:
1. Citation trail hook - 3.27s - product kicker and `What survives the citation trail?`
2. Ask and choose witnesses - 5.47s - real question, selected surfaces, and `Collect answers`
3. Answers arrive - 4.37s - three labeled answer cards and citation status
4. Follow the evidence - 4.36s - claim comparison and answer-to-document graph
5. No truth score - 5.46s - final principle and wordmark lockup

## Audio
- Audio role: restrained cinematic support with precise UI accents
- Audio arc: low steady bed, tactile collection click, clean answer/evidence build, final bell under the principle lockup
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`
- Music treatment: `data-volume="0.28"`; no voiceover; keep the bed present but subordinate to copy and SFX
- Music cue guidance: `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`; strong cue targets 8.74s, 17.47s, 22.93s; use beat-grid timing only when it preserves reading time
- Audio-reactive treatment: skipped; the optional Python extraction helper is unavailable in this environment. Do not add waveform or equalizer graphics.
- Audio-coupled moments:
  - witness chips - sequential reveal with restrained UI accents
  - answer cards - major reveal near 8.74s
  - graph edges - evidence resolution near 17.47s
  - final wordmark - final cue near 22.93s
- SFX selection guidance: use low-risk interface click, soft impact reveal, and one warm bell. Keep all SFX below 0.8 volume.
- SFX analysis guidance: `C:\Users\iamte\.agents\skills\brag\assets\sfx\sfx-analysis.md`
- Exact SFX choice: `assets/sfx/interface/click_003.ogg`, `assets/sfx/impact/impactSoft_medium_001.ogg`, `assets/sfx/impact/impactBell_heavy_000.ogg`
- Audio files: copied into `brag-output/composition/assets/`

## Hyperframes Instructions
Use one paused GSAP timeline registered as `window.__timelines["consensus-brag"]`. Every scene is a timed `.clip`; inner elements use explicit `fromTo` states so the result is seek-safe. Keep all composition claims grounded in the source project. Use local assets and run `npx hyperframes check` before rendering.
