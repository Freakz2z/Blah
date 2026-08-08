/**
 * Logged-in user profile (avatar + nickname) via the Toy JS SDK.
 *
 * The SDK object is injectable for tests; production defaults to `window.toy`.
 * Every call degrades silently — a guest or a pending consent dialog must
 * never break the app. The first-ever `getUserProfile` needs a user gesture
 * (the platform shows a data-confirmation dialog); later calls reuse it.
 */

export interface ToyUserProfile {
  nickname: string;
  avatar: string;
  /** Stable pseudonymous per-Toy user id — the key for relay-backed history.
   * Absent when the platform's OpenID mode is off. */
  toyOpenId?: string;
}

export interface ToyProfileSdk {
  getUserProfile(): Promise<{ nickname: string; avatar: string; toyOpenId?: string }>;
}

function toySdk(): ToyProfileSdk | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { toy?: unknown }).toy;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof (candidate as ToyProfileSdk).getUserProfile !== "function"
  ) {
    return null;
  }
  return candidate as ToyProfileSdk;
}

/** Fetch the user profile, or `null` when unavailable (guest, consent pending,
 * SDK absent, or the call failed). */
export async function fetchUserProfile(
  sdk: ToyProfileSdk | null = toySdk(),
): Promise<ToyUserProfile | null> {
  if (!sdk) return null;
  try {
    const profile = await sdk.getUserProfile();
    if (
      !profile ||
      typeof profile.nickname !== "string" ||
      typeof profile.avatar !== "string"
    ) {
      return null;
    }
    const result: ToyUserProfile = { nickname: profile.nickname, avatar: profile.avatar };
    if (typeof profile.toyOpenId === "string" && profile.toyOpenId) {
      result.toyOpenId = profile.toyOpenId;
    }
    return result;
  } catch {
    return null;
  }
}
