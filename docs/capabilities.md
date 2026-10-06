# SerpApi capability matrix

## Live capability gate

The initial five-question gate used 24 request attempts with no automatic retries.

| Surface | Probes tested | Technical completions | Answers with URLs | Gate result |
|---|---:|---:|---:|---|
| Google Search baseline | 5 | 5 | 0 | Discovery only; not an answer surface |
| Google AI Mode | 5 | 5 | 3 | **Pass** |
| Bing Copilot | 5 | 5 | 5 | **Pass** |
| Google AI Overview | 5 | 2 | 0 | Fail: follow-up requests returned provider no-results responses |
| Brave AI Mode | 1 | 1 | 0 | Unvalidated in initial run |

## Targeted rerun

The AI Overview and Brave probes were rerun with a 15-attempt ceiling. The run used 13 request attempts.

| Surface | Probes tested | Technical completions | Answers with URLs | Gate result |
|---|---:|---:|---:|---|
| Google AI Overview | 5 | 2 | 2 | Still fails the gate |
| Brave AI Mode | 5 | 5 | 5 | **Pass** |

## Decision

The validated answer surfaces are Google AI Mode, Bing Copilot, and Brave AI Mode. Google Search remains discovery material, not a vote. Google AI Overview remains experimental because its current follow-up reliability does not meet the capability gate.

The development guard is set to 200 successful searches total. SerpApi Account API usage was 19 before the targeted rerun and 23 afterward, leaving 177 successful searches before the development ceiling. Provider continuation tokens are excluded from this report.
