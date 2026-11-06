// Prepara os arquivos do app Android do dono (APK) em app-www/.
// O APK abre direto o app do dono (admin) e conversa com o servidor local ou com o Supabase.
import { cpSync, writeFileSync, rmSync } from 'node:fs';

rmSync('app-www', { recursive: true, force: true });
cpSync('public', 'app-www', { recursive: true, filter: (src) => !src.includes('/tools') });
writeFileSync('app-www/index.html', `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0;url=admin/index.html"><title>Cardápio 3D Dono</title></head>
<body style="background:#2a1f17"><script>location.replace('admin/index.html')</script></body></html>
`);
console.log('app-www pronto');
