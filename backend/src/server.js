import { init } from './db.js';
import { app } from './app.js';
await init();
app.listen(process.env.PORT || 4000, () => console.log('TriageSync API listening'));
