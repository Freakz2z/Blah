import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchUserProfile } from "../toy/src/profile.ts";

test("fetchUserProfile returns the normalized profile", async () => {
  const sdk = {
    async getUserProfile() {
      return { nickname: "张三", avatar: "//p0.hdslb.com/a.png", toyOpenId: "openid" };
    },
  };
  assert.deepEqual(await fetchUserProfile(sdk), {
    nickname: "张三",
    avatar: "//p0.hdslb.com/a.png",
  });
});

test("fetchUserProfile returns null without a SDK, on rejection, or on a malformed profile", async () => {
  assert.equal(await fetchUserProfile(null), null);

  const broken = {
    async getUserProfile() {
      throw new Error("denied");
    },
  };
  assert.equal(await fetchUserProfile(broken), null);

  const malformed = {
    async getUserProfile() {
      return { nickname: 42, avatar: "" };
    },
  };
  assert.equal(await fetchUserProfile(malformed), null);
});
