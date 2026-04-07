/**
 * Phase 5: Session export/import routes.
 *
 * Mounted at: /api/sessions  (before sessionsRouter)
 *
 * GET  /:id/export  — download full-fidelity JSON
 * POST /import      — create a new session from exported JSON
 */
import { Router } from 'express';
import { eq, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  sessions,
  agents,
  iterations,
  reflections,
  chatMessages,
  roleChanges,
  depositAccounts,
  loanContracts,
  bankBalanceSheets,
} from '../db/schema.js';
import * as capitalMarketRepo from '../db/repos/capitalMarketRepo.js';
import * as fiscalRepo from '../db/repos/fiscalRepo.js';
import * as macroSnapshotRepo from '../db/repos/macroSnapshotRepo.js';
import { v4 as uuidv4 } from 'uuid';
import type { SessionExport } from '@policylab/shared';
import { getSessionTelemetry } from '../orchestration/simulationRunner.js';

const router = Router();

// GET /:id/export
router.get('/:id/export', async (req, res) => {
  const { id } = req.params as { id: string };

  try {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, id));
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const [agentRows, iterRows, reflRows, msgRows, rcRows, depositRows, loanRows, balanceSheetRows] = await Promise.all([
    db.select().from(agents).where(eq(agents.sessionId, id)),
    db.select().from(iterations).where(eq(iterations.sessionId, id)).orderBy(asc(iterations.iterationNumber)),
    db.select().from(reflections).where(eq(reflections.sessionId, id)),
    db.select().from(chatMessages).where(eq(chatMessages.sessionId, id)).orderBy(asc(chatMessages.timestamp)),
    db.select().from(roleChanges).where(eq(roleChanges.sessionId, id)),
    db.select().from(depositAccounts).where(eq(depositAccounts.sessionId, id)),
    db.select().from(loanContracts).where(eq(loanContracts.sessionId, id)),
    db.select().from(bankBalanceSheets).where(eq(bankBalanceSheets.sessionId, id)),
  ]);

  const exportData: SessionExport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    session: {
      id: session.id,
      title: session.title,
      idea: session.idea,
      stage: session.stage as SessionExport['session']['stage'],
      config: session.config ? JSON.parse(session.config) : null,
      law: session.law ?? null,
      societyOverview: session.societyOverview ?? null,
      timeScale: session.timeScale ?? null,
      societyEvaluation: session.societyEvaluation ?? null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      completedAt: session.completedAt ?? null,
    },
    agents: agentRows.map(a => ({
      id: a.id,
      sessionId: a.sessionId,
      name: a.name,
      role: a.role,
      background: a.background,
      initialStats: (() => { try { return JSON.parse(a.initialStats); } catch { return {}; } })(),
      currentStats: (() => { try { return JSON.parse(a.currentStats); } catch { return {}; } })(),
      isAlive: a.status === 'alive',
      isCentralAgent: a.type === 'central' || undefined,
      status: a.status,
      type: a.type,
      bornAtIteration: a.bornAtIteration ?? null,
      diedAtIteration: a.diedAtIteration ?? null,
      age: a.age ?? undefined,
      weightKg: a.weightKg ?? undefined,
      personalityTraits: (() => { try { return JSON.parse(a.personalityTraits); } catch { return []; } })(),
      allostaticStrain: a.allostaticStrain ?? 0,
      allostaticLoad: a.allostaticLoad ?? 0,
    })),
    iterations: iterRows.map(it => ({
      iterationNumber: it.iterationNumber,
      stateSummary: it.stateSummary,
      statistics: it.statistics,
      lifecycleEvents: it.lifecycleEvents,
      timestamp: it.timestamp,
    })),
    reflections: reflRows.map(r => ({
      agentId: r.agentId ?? null,
      content: r.content,
      insights: r.insights ?? null,
      createdAt: r.createdAt,
    })),
    chatMessages: msgRows.map(m => ({
      context: m.context,
      agentId: m.agentId ?? null,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    })),
    roleChanges: rcRows.map(rc => ({
      agentId: rc.agentId,
      fromRole: rc.fromRole,
      toRole: rc.toRole,
      reason: rc.reason ?? null,
      iterationNumber: rc.iterationNumber,
      timestamp: rc.timestamp,
    })),
    telemetryLogs: getSessionTelemetry(id),
    // Banking Foundation tables (present only when session used banking)
    depositAccounts: depositRows.length > 0 ? depositRows.map(d => ({
      id: d.id,
      sessionId: d.sessionId,
      ownerAgentId: d.ownerAgentId,
      bankAgentId: d.bankAgentId,
      accountType: d.accountType as 'demand',
      balance: d.balance,
      interestRate: d.interestRate,
      lastUpdated: d.lastUpdated,
    })) : undefined,
    loanContracts: loanRows.length > 0 ? loanRows.map(l => ({
      id: l.id,
      sessionId: l.sessionId,
      borrowerAgentId: l.borrowerAgentId,
      lenderAgentId: l.lenderAgentId,
      principal: l.principal,
      interestRate: l.interestRate,
      termIterations: l.termIterations,
      remainingBalance: l.remainingBalance,
      collateralAmount: l.collateralAmount,
      consecutiveMissed: l.consecutiveMissed,
      issuedAtIteration: l.issuedAtIteration,
      dueAtIteration: l.dueAtIteration,
      status: l.status as 'active' | 'repaid' | 'defaulted',
      createdAt: l.createdAt,
    })) : undefined,
    bankBalanceSheets: balanceSheetRows.length > 0 ? balanceSheetRows.map(b => ({
      id: b.id,
      sessionId: b.sessionId,
      agentId: b.agentId,
      iterationNumber: b.iterationNumber,
      reserves: b.reserves,
      loanAssets: b.loanAssets,
      depositLiabilities: b.depositLiabilities,
      equity: b.equity,
      timestamp: b.timestamp,
    })) : undefined,
    // Capital Markets tables (present only when session used capital markets)
    equityPositions: (() => {
      const rows = capitalMarketRepo.getEquityPositionsBySession(id);
      return rows.length > 0 ? rows : undefined;
    })(),
    bondHoldings: (() => {
      const rows = capitalMarketRepo.getBondHoldingsBySession(id);
      return rows.length > 0 ? rows : undefined;
    })(),
    // Fiscal Policy tables (present only when session used fiscal policy)
    fiscalBudget: (() => {
      const budget = fiscalRepo.getActiveBudget(id);
      return budget ?? undefined;
    })(),
    publicGoodsState: (() => {
      const states = fiscalRepo.getPublicGoodsStateBySession(id);
      return states.length > 0 ? states : undefined;
    })(),
    macroSnapshots: (() => {
      const rows = macroSnapshotRepo.getSnapshotsBySession(db, id);
      return rows.length > 0 ? rows : undefined;
    })(),
  };

  const safeTitle = session.title.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="session-${safeTitle}.json"`);
  return res.json(exportData);
  } catch (err) {
    console.error('GET /sessions/:id/export error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: 'Export failed', detail });
  }
});

// POST /import
router.post('/import', async (req, res) => {
  const body = req.body as Partial<SessionExport>;

  if (body.version !== 1) {
    return res.status(400).json({ error: 'Invalid export file: missing version field' });
  }
  if (!body.session) {
    return res.status(400).json({ error: 'Invalid export file: missing session data' });
  }

  const src = body.session;
  const newSessionId = uuidv4();
  const now = new Date().toISOString();

  // Build agent ID remapping: old → new
  const agentIdMap = new Map<string, string>();
  for (const a of body.agents ?? []) {
    agentIdMap.set(a.id, uuidv4());
  }

  try {
    // Insert session (with " (imported)" suffix to distinguish)
    await db.insert(sessions).values({
      id: newSessionId,
      title: `${src.title} (imported)`,
      idea: src.idea,
      stage: src.stage,
      config: src.config ? JSON.stringify(src.config) : null,
      law: src.law ?? null,
      societyOverview: src.societyOverview ?? null,
      timeScale: src.timeScale ?? null,
      societyEvaluation: src.societyEvaluation ?? null,
      createdAt: now,
      updatedAt: now,
      completedAt: src.completedAt ?? null,
    });

    // Insert agents
    const agentRows = (body.agents ?? []).map(a => ({
      id: agentIdMap.get(a.id) ?? uuidv4(),
      sessionId: newSessionId,
      name: a.name,
      role: a.role,
      background: a.background,
      initialStats: JSON.stringify(a.initialStats),
      currentStats: JSON.stringify(a.currentStats),
      type: a.type ?? 'citizen',
      status: a.status ?? 'alive',
      bornAtIteration: a.bornAtIteration ?? undefined,
      diedAtIteration: a.diedAtIteration ?? undefined,
      age: a.age ?? undefined,
      weightKg: a.weightKg ?? undefined,
      personalityTraits: a.personalityTraits ? JSON.stringify(a.personalityTraits) : '[]',
      allostaticStrain: a.allostaticStrain ?? 0,
      allostaticLoad: a.allostaticLoad ?? 0,
    }));
    for (let i = 0; i < agentRows.length; i += 25) {
      if (agentRows.slice(i, i + 25).length > 0) {
        await db.insert(agents).values(agentRows.slice(i, i + 25));
      }
    }

    // Insert iterations
    for (const it of body.iterations ?? []) {
      await db.insert(iterations).values({
        id: uuidv4(),
        sessionId: newSessionId,
        iterationNumber: it.iterationNumber,
        stateSummary: it.stateSummary,
        statistics: it.statistics,
        lifecycleEvents: it.lifecycleEvents,
        timestamp: it.timestamp,
      });
    }

    // Insert reflections (remap agentId)
    for (const r of body.reflections ?? []) {
      const newAgentId = r.agentId ? (agentIdMap.get(r.agentId) ?? null) : null;
      await db.insert(reflections).values({
        id: uuidv4(),
        sessionId: newSessionId,
        agentId: newAgentId,
        content: r.content,
        insights: r.insights ?? null,
        createdAt: r.createdAt,
      });
    }

    // Insert chatMessages (remap agentId)
    for (const m of body.chatMessages ?? []) {
      const newAgentId = m.agentId ? (agentIdMap.get(m.agentId) ?? null) : null;
      await db.insert(chatMessages).values({
        id: uuidv4(),
        sessionId: newSessionId,
        context: m.context,
        agentId: newAgentId,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      });
    }

    // Insert roleChanges (remap agentId)
    for (const rc of body.roleChanges ?? []) {
      const newAgentId = agentIdMap.get(rc.agentId);
      if (!newAgentId) continue; // skip if agent not found (shouldn't happen)
      await db.insert(roleChanges).values({
        id: uuidv4(),
        sessionId: newSessionId,
        agentId: newAgentId,
        fromRole: rc.fromRole,
        toRole: rc.toRole,
        reason: rc.reason ?? null,
        iterationNumber: rc.iterationNumber,
        timestamp: rc.timestamp,
      });
    }

    // Insert banking data if present (Banking Foundation — backward compatible)
    if (body.depositAccounts && body.depositAccounts.length > 0) {
      for (const d of body.depositAccounts) {
        const newOwnerId = agentIdMap.get(d.ownerAgentId) ?? null;
        const newBankId = agentIdMap.get(d.bankAgentId) ?? null;
        if (!newOwnerId || !newBankId) continue; // skip if agent not found
        await db.insert(depositAccounts).values({
          id: uuidv4(),
          sessionId: newSessionId,
          ownerAgentId: newOwnerId,
          bankAgentId: newBankId,
          accountType: d.accountType,
          balance: d.balance,
          interestRate: d.interestRate,
          lastUpdated: d.lastUpdated,
        });
      }
    }

    if (body.loanContracts && body.loanContracts.length > 0) {
      for (const l of body.loanContracts) {
        const newBorrowerId = agentIdMap.get(l.borrowerAgentId) ?? null;
        const newLenderId = agentIdMap.get(l.lenderAgentId) ?? null;
        if (!newBorrowerId || !newLenderId) continue; // skip if agent not found
        await db.insert(loanContracts).values({
          id: uuidv4(),
          sessionId: newSessionId,
          borrowerAgentId: newBorrowerId,
          lenderAgentId: newLenderId,
          principal: l.principal,
          interestRate: l.interestRate,
          termIterations: l.termIterations,
          remainingBalance: l.remainingBalance,
          collateralAmount: l.collateralAmount,
          consecutiveMissed: l.consecutiveMissed,
          issuedAtIteration: l.issuedAtIteration,
          dueAtIteration: l.dueAtIteration,
          status: l.status,
          createdAt: l.createdAt,
        });
      }
    }

    if (body.bankBalanceSheets && body.bankBalanceSheets.length > 0) {
      for (const b of body.bankBalanceSheets) {
        const newAgentId = agentIdMap.get(b.agentId) ?? null;
        if (!newAgentId) continue; // skip if agent not found
        await db.insert(bankBalanceSheets).values({
          id: uuidv4(),
          sessionId: newSessionId,
          agentId: newAgentId,
          iterationNumber: b.iterationNumber,
          reserves: b.reserves,
          loanAssets: b.loanAssets,
          depositLiabilities: b.depositLiabilities,
          equity: b.equity,
          timestamp: b.timestamp,
        });
      }
    }

    // Capital Markets: equity positions with agent ID remapping
    if (body.equityPositions && body.equityPositions.length > 0) {
      for (const pos of body.equityPositions) {
        const newOwnerId = agentIdMap.get(pos.ownerAgentId) ?? pos.ownerAgentId;
        // enterpriseOwnerId is also an agentId — remap it too
        const newEnterpriseOwnerId = agentIdMap.get(pos.enterpriseOwnerId) ?? pos.enterpriseOwnerId;
        capitalMarketRepo.upsertEquityPosition({
          ...pos,
          id: uuidv4(),
          ownerAgentId: newOwnerId,
          enterpriseOwnerId: newEnterpriseOwnerId,
          sessionId: newSessionId,
        });
      }
    }

    // Capital Markets: bond holdings with agent ID remapping
    if (body.bondHoldings && body.bondHoldings.length > 0) {
      for (const holding of body.bondHoldings) {
        const newOwnerId = agentIdMap.get(holding.ownerAgentId) ?? holding.ownerAgentId;
        // issuerId: 'treasury' stays as-is; agent IDs get remapped
        const newIssuerId = holding.issuerId === 'treasury'
          ? 'treasury'
          : (agentIdMap.get(holding.issuerId) ?? holding.issuerId);
        capitalMarketRepo.upsertBondHolding({
          ...holding,
          id: uuidv4(),
          ownerAgentId: newOwnerId,
          issuerId: newIssuerId,
          sessionId: newSessionId,
        });
      }
    }

    // Fiscal Policy: budget allocation (no agent ID remapping needed)
    if (body.fiscalBudget) {
      fiscalRepo.upsertBudget({
        id: uuidv4(),
        sessionId: newSessionId,
        infrastructure: body.fiscalBudget.infrastructure,
        education: body.fiscalBudget.education,
        defense: body.fiscalBudget.defense,
        welfare: body.fiscalBudget.welfare,
        createdAt: new Date().toISOString(),
      });
    }

    // Fiscal Policy: public goods state history
    if (body.publicGoodsState && body.publicGoodsState.length > 0) {
      for (const state of body.publicGoodsState) {
        fiscalRepo.upsertPublicGoodsState({
          ...state,
          id: uuidv4(),
          sessionId: newSessionId,
        });
      }
    }

    if (body.macroSnapshots && body.macroSnapshots.length > 0) {
      for (const snapshot of body.macroSnapshots) {
        macroSnapshotRepo.insertMacroSnapshot(db, {
          sessionId: newSessionId,
          iterationNumber: snapshot.iterationNumber,
          m0: snapshot.m0,
          m1: snapshot.m1,
          cpi: snapshot.cpi,
          inflationRate: snapshot.inflationRate,
          inflationExpectations: snapshot.inflationExpectations,
          totalLoansOutstanding: snapshot.totalLoansOutstanding,
          treasuryBalance: snapshot.treasuryBalance,
        });
      }
    }

    return res.status(201).json({ id: newSessionId });
  } catch (err) {
    console.error('POST /api/sessions/import error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: 'Import failed', detail });
  }
});

export default router;
