"use strict";
// My plan and Admin: rendered from sample server answers in a real browser. The page here is
// the static client (local mode), so the server-only links must stay hidden.
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
const tiers = [
  { id: "free", name: "Free", pages: 150, price: 0, once: true }, { id: "tier1", name: "Tier 1", pages: 500, price: 7 },
  { id: "tier2", name: "Tier 2", pages: 1500, price: 14 }, { id: "tier3", name: "Tier 3", pages: 3000, price: 24 }];

for (const lang of ["en", "vi"]) {
  test("My plan shows pages left, the reset day, the tiers and what used pages (" + lang + ")", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(base + "/");
      await page.waitForFunction(() => typeof window.renderPlan === "function");
      const out = await page.evaluate(({ lang, tiers, DAY }) => {
        applyLanguage(lang);
        const now = Math.floor(Date.now() / 1000);
        renderPlan({ plan: "tier1", name: "Tier 1", limit: 500, used: 320, remaining: 180, resetsAt: now + 10 * DAY,
          expiresAt: now + 40 * DAY, pendingPlan: "free", pendingAt: now + 10 * DAY, tiers, reserveTtl: DAY,
          history: [
            { kind: "job", pages: 240, status: "committed", title: "PMP Prep", created_at: now - DAY },
            { kind: "job", pages: 90, status: "reserved", title: "AWS", created_at: now - 2 * DAY },
            { kind: "adjust", pages: 80, status: "done", note: "pilot", created_at: now - 3 * DAY }] });
        const txt = (s) => document.querySelector(s).textContent.trim();
        return {
          left: txt("#plan-left-num"), of: txt("#plan-left-of"), reset: txt("#plan-reset-line"),
          pending: txt("#plan-pending-line"), pill: txt("#plan-current-pill"),
          current: [...document.querySelectorAll(".plan-tier.is-current")].map((e) => e.textContent),
          rows: [...document.querySelectorAll(".plan-history-table tbody tr")].map((r) => [...r.cells].map((c) => c.textContent)),
          bar: document.getElementById("plan-bar-fill").style.width,
          planLink: document.getElementById("sidebar-plan-link").classList.contains("hidden"),
          adminLink: document.getElementById("sidebar-admin-link").classList.contains("hidden"),
        };
      }, { lang, tiers, DAY });
      assert.equal(out.left, "180");
      assert.match(out.of, lang === "en" ? /500 pages left this month/ : /500 trang còn lại tháng này/);
      assert.match(out.reset, lang === "en" ? /you get 500 pages again/ : /bạn có lại 500 trang/);
      assert.match(out.pending, /Free/);
      assert.match(out.pill, /^Tier 1 · /);
      assert.equal(out.current.length, 1);
      assert.match(out.current[0], /Tier 1/);
      assert.equal(out.bar, "64%");
      assert.equal(out.rows.length, 3);
      assert.equal(out.rows[0][2], "−240");
      assert.equal(out.rows[1][2], "0", "a reservation older than a day counts as returned");
      assert.match(out.rows[1][1], lang === "en" ? /pages returned/ : /đã hoàn lại/);
      assert.match(out.rows[2][1], /pilot/);
      assert.ok(out.planLink && out.adminLink, "server-only links stay hidden in local mode");
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}

test("Admin shows counts, a readable chart and a table that fits a desktop", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base + "/");
    await page.waitForFunction(() => typeof window.renderAdminOverview === "function");
    const out = await page.evaluate(({ tiers, DAY }) => {
      applyLanguage("vi");
      showScreen("admin");
      const now = Math.floor(Date.now() / 1000);
      const weeks = Array.from({ length: 12 }, (_, i) => ({ end: now - (11 - i) * 7 * DAY, registered: 18 + 2 * i, active: 7 + (i % 4) }));
      renderAdminOverview({ registered: 40, new7: 5, activeToday: 6, active7: 12, active30: 19, weeks, tiers,
        byPlan: { free: 31, tier1: 6, tier2: 2, tier3: 1 } });
      adminState.users = [{ id: "u1", name: "Lan Trần", email: "lan.tran.with.a.long.address@example.com", created_at: now - 80 * DAY,
        last_at: now - 3 * DAY, answers30: 412, classes: 6, cards: 1840,
        plan: { plan: "tier1", name: "Tier 1", limit: 500, used: 520, remaining: 0, expiresAt: now + 30 * DAY, pendingPlan: null } }];
      renderAdminUsers(1);
      const labels = [...document.querySelectorAll("#admin-chart text")].filter((t) => t.getAttribute("y") === "212")
        .map((t) => t.getBoundingClientRect());
      const overlap = labels.some((a, i) => labels.some((b, j) => j > i && a.right > b.left && b.right > a.left));
      const wrap = document.querySelector(".admin-table-wrap");
      const cells = [...document.querySelectorAll("#admin-rows td")].map((c) => c.textContent.trim());
      return {
        stats: [...document.querySelectorAll(".admin-stat")].map((s) => s.textContent),
        overlap, fits: wrap.scrollWidth <= wrap.clientWidth, cells,
        empty: document.querySelector("#admin-rows .plan-bar").classList.contains("is-empty"),
      };
    }, { tiers, DAY });
    assert.equal(out.stats.length, 5);
    assert.match(out.stats[2], /12/);
    assert.match(out.stats[2], /30% đã đăng ký/);
    assert.ok(!out.overlap, "the chart's week labels do not run into each other");
    assert.ok(out.fits, "the user table fits a 1440px window");
    assert.equal(out.cells[2], "3 ngày trước");
    assert.deepEqual(out.cells.slice(3, 6), ["412", "6", "1.840"]);
    assert.match(out.cells[6], /Tier 1đến /);
    assert.ok(out.empty, "a user with no pages left gets the red bar");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("every plan and admin string exists in both languages, and the links open their screens", () => {
  const app = fs.readFileSync(path.join(root, "client", "app.js"), "utf8");
  const keys = new Set(app.match(/"(plan|admin)\.[A-Za-z0-9.]*[A-Za-z0-9]"/g));
  for (const k of keys) assert.equal(app.split(k + ":").length - 1, 2, k);
  assert.match(app, /plan: "sidebar-plan-link", admin: "sidebar-admin-link"/);
  assert.match(app, /sidebar-admin-link"\)\.classList\.toggle\("hidden", !currentUser\.isAdmin\)/);
});
