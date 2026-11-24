"use strict";
// Suspend, restore and delete on the admin page, rendered from sample server answers in a
// real browser: the pill and note on a suspended row, the buttons each kind of row gets, the
// filter counts, the account log, and the delete button that waits for the typed email.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const express = require("express");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
let base, listener, browser;
test.before(async () => {
  await new Promise((ok) => {
    const server = express();
    server.use(express.static(path.join(root, "client")));
    listener = server.listen(0, "127.0.0.1", () => { base = "http://127.0.0.1:" + listener.address().port; ok(); });
  });
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { if (browser) await browser.close(); listener.close(); });

const DAY = 86400;

for (const lang of ["en", "vi"]) {
  test("suspended rows, their buttons, the filter, the log and the delete confirmation (" + lang + ")", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(base + "/");
      await page.waitForFunction(() => typeof window.renderAdminUsers === "function");
      const out = await page.evaluate(({ lang, DAY }) => {
        applyLanguage(lang);
        showScreen("admin");
        currentUser = { id: "boss", isAdmin: true };
        const now = Math.floor(Date.now() / 1000);
        const plan = { plan: "free", name: "Free", limit: 150, used: 10, remaining: 140, expiresAt: null, pendingPlan: null };
        adminState.tiers = [{ id: "free", name: "Free" }];
        renderAdminOverview({ registered: 38, new7: 2, activeToday: 3, active7: 9, active30: 12, suspended: 2, byPlan: { free: 38 },
          tiers: adminState.tiers, weeks: Array.from({ length: 12 }, (_, i) => ({ end: now - (11 - i) * 7 * DAY, registered: 30 + i, active: 5 })) });
        adminState.users = [
          { id: "u1", name: "Lan", email: "lan@example.com", created_at: now - 9 * DAY, last_at: now, answers30: 4, classes: 2, cards: 40, plan },
          { id: "u2", name: "Minh", email: "Minh.Le@example.com", created_at: now - 20 * DAY, last_at: null, answers30: 0, classes: 3, cards: 1620, plan,
            suspended_at: now - DAY, suspended_by: "boss", suspended_by_name: "Boss", suspended_note: "asked to close" },
          { id: "boss", name: "Boss", email: "boss@example.com", created_at: now - 99 * DAY, last_at: now, answers30: 9, classes: 1, cards: 5, plan, isAdmin: true }];
        renderAdminUsers(40, { all: 40, active: 38, suspended: 2 });
        renderAdminLog([
          { user_id: "u2", email: "minh.le@example.com", action: "suspend", by_user_id: "boss", by_name: "Boss", note: "asked to close", created_at: now - DAY, deleted: 0 },
          { user_id: "u9", email: "old@example.com", action: "delete", by_user_id: "boss", by_name: "Boss", note: "test", pages: 120, created_at: now - 5 * DAY, deleted: 1 }]);
        const rows = [...document.querySelectorAll("#admin-rows tr")];
        const btns = (r) => [...r.querySelectorAll("button")].map((b) => Object.keys(b.dataset)[0]);
        const wrap = document.querySelector(".admin-table-wrap");
        const r = {
          susLine: document.getElementById("admin-suspended-line").textContent,
          counts: [...document.querySelectorAll("#admin-filter [data-count]")].map((e) => e.textContent),
          pressed: document.querySelector('#admin-filter [aria-pressed="true"]').dataset.status,
          live: btns(rows[0]), sus: btns(rows[1]), admin: btns(rows[2]),
          susClass: rows[1].classList.contains("is-suspended"),
          pill: rows[1].querySelector(".admin-pill-sus").textContent,
          note: rows[1].querySelector(".admin-susnote").textContent,
          fits: wrap.scrollWidth <= wrap.clientWidth,
          log: [...document.querySelectorAll("#admin-log tbody tr")].map((tr) => [...tr.cells].map((c) => c.textContent)),
        };
        // The row's listeners are wired in server mode only; this page is the static client.
        openAdminDeleteModal(adminState.users[Number(rows[1].querySelector("[data-admin-delete]").dataset.adminDelete)]);
        const go = document.getElementById("btn-admin-delete-save");
        const typeIn = (v) => { const el = document.getElementById("admin-delete-email"); el.value = v; adminDeleteTyped(); return go.disabled; };
        r.deleteOpen = !document.getElementById("modal-admin-delete").classList.contains("hidden");
        r.what = document.getElementById("admin-delete-what").textContent;
        r.label = document.getElementById("admin-delete-type-label").textContent;
        r.disabled = [go.disabled, typeIn("minh.le@example"), typeIn(" minh.le@EXAMPLE.com ")];
        return r;
      }, { lang, DAY });
      const en = lang === "en";
      assert.match(out.susLine, en ? /2 suspended, not counted above/ : /2 tài khoản bị khóa/);
      assert.deepEqual(out.counts, ["40", "38", "2"]);
      assert.equal(out.pressed, "all");
      assert.deepEqual(out.live, ["adminPlan", "adminPages", "adminSuspend"]);
      assert.deepEqual(out.sus, ["adminRestore", "adminDelete"]);
      assert.deepEqual(out.admin, [], "an admin's row has no buttons");
      assert.ok(out.susClass);
      assert.equal(out.pill, en ? "Suspended" : "Bị khóa");
      assert.match(out.note, en ? /by you: asked to close$/ : /bởi bạn: asked to close$/);
      assert.ok(out.fits, "the table still fits a 1440px window");
      assert.equal(out.log.length, 2);
      assert.match(out.log[1][1], en ? /old@example\.com \(deleted\)/ : /\(đã xóa\)/);
      assert.match(out.log[1][2], en ? /120 pages used/ : /120 trang/);
      assert.equal(out.log[0][3], en ? "you" : "bạn");
      assert.ok(out.deleteOpen);
      assert.match(out.what, /3.*1[.,]620/);
      assert.match(out.label, /Minh\.Le@example\.com/);
      assert.deepEqual(out.disabled, [true, true, false], "Delete waits for the whole email, in any case");
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}

test("every new string exists in both languages, and a suspended sign-in is explained", () => {
  const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
  for (const k of ["error.accountSuspended", "error.linkUnavailable", "error.email_mismatch", "error.is_admin", "error.not_suspended", "error.already_suspended"])
    assert.equal(app.split('"' + k + '":').length - 1, 2, k);
  assert.match(app, /account_suspended: t\("error\.accountSuspended"\)/);
  assert.match(app, /data\.code === "linkUnavailable"/);
  assert.match(app, /"admin-delete-email"\)\.addEventListener\("input", adminDeleteTyped\)/);
  assert.match(app, /dataset\.adminDelete !== undefined\) openAdminDeleteModal/);
});
