import express from 'express';
import cors from 'cors';
import { runMigrations } from './db/migrate.js';
import sessionsRouter from './routes/sessions.js';
import settingsRouter from './routes/settings.js';
import chatRouter from './routes/chat.js';
import designRouter from './routes/design.js';
import simulateRouter from './routes/simulate.js';
import iterationsRouter from './routes/iterations.js';
import reflectRouter from './routes/reflect.js';
import reviewRouter from './routes/review.js';
import artifactsRouter from './routes/artifacts.js';
import compareRouter from './routes/compare.js';
import importExportRouter from './routes/importexport.js';

const app = express();

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '50mb' }));

// Sub-routers with :id param must be mounted BEFORE base /api/sessions
app.use('/api/sessions/:id/chat', chatRouter);
app.use('/api/sessions/:id/design', designRouter);
app.use('/api/sessions/:id/simulate', simulateRouter);
app.use('/api/sessions/:id/iterations', iterationsRouter);
app.use('/api/sessions/:id/reflect', reflectRouter);
app.use('/api/sessions/:id/review', reviewRouter);
app.use('/api/sessions/:id/artifacts', artifactsRouter);
// Phase 5: import/export (must be before sessionsRouter to catch POST /import)
app.use('/api/sessions', importExportRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/compare', compareRouter);

// Run DB migrations before starting
runMigrations();

const PORT = 3001;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
});
