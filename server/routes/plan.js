"use strict";

const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const plans = require("../lib/plans");

const router = express.Router();

// GET /api/plan: the user's own plan, pages left, and what used them.
router.get("/", requireAuth, (req, res) => {
  const s = plans.status(db, req.session.userId);
  res.json({
    ...s,
    tiers: plans.ORDER.map((id) => ({ id, ...plans.PLANS[id] })),
    history: plans.history(db, req.session.userId),
    reserveTtl: plans.RESERVE_TTL,
  });
});

module.exports = router;
