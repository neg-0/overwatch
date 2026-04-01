/**
 * demo-mode.ts — Runtime demo mode state.
 *
 * Global toggle: when enabled, the OpenAI client proxy checks the LlmCache
 * table before making live LLM calls. All LLM responses are always cached
 * regardless of this flag.
 */

let demoModeEnabled = false;

export function isDemoMode(): boolean {
  return demoModeEnabled;
}

export function setDemoMode(enabled: boolean): void {
  demoModeEnabled = enabled;
  console.log(`[DemoMode] ${enabled ? '🟢 ENABLED' : '🔴 DISABLED'}`);
}
