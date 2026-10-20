/* Genera dist-demo/: versión estática que funciona sin servidor (SQLite en el navegador). */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'dist-demo');
fs.rmSync(out, { recursive: true, force: true });
for (const d of ['css', 'js', 'database']) fs.mkdirSync(path.join(out, d), { recursive: true });

const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
// Conservar el viewport: sin él el navegador móvil reduce toda la interfaz.
const prefix = html.slice(0, html.indexOf('<!--APP-START-->'));
const body = html.slice(html.indexOf('<!--APP-START-->'), html.indexOf('<!--APP-END-->') + '<!--APP-END-->'.length);
const page = `${prefix}${body}
<script>window.RESERVA_DEMO = true;</script>
<script src="js/sql-asm.js"></script>
<script src="js/service.js"></script>
<script src="js/routes.js"></script>
<script src="js/api.js"></script>
<script src="js/app.js"></script>
</body>
</html>
`;
fs.writeFileSync(path.join(out, 'index.html'), page);
const copy = (a, b) => fs.copyFileSync(path.join(root, a), path.join(out, b));
copy('public/css/styles.css', 'css/styles.css');
copy('public/js/api.js', 'js/api.js');
copy('public/js/app.js', 'js/app.js');
copy('src/service.js', 'js/service.js');
copy('src/routes.js', 'js/routes.js');
copy('database/schema.sql', 'database/schema.sql');
copy('database/seed.sql', 'database/seed.sql');
fs.copyFileSync(require.resolve('sql.js/dist/sql-asm.js'), path.join(out, 'js', 'sql-asm.js'));
console.log('dist-demo listo');
