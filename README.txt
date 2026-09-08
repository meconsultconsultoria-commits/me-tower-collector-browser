ME TOWER - COLETOR RASTRO SEGURO

Arquivos:
- collect.js: abre o Rastro Seguro em navegador virtual e coleta os veículos.
- package.json: dependências.
- .github/workflows/coleta.yml: execução manual e automática a cada 5 minutos.

GitHub Secrets necessários:
- RASTRO_USER
- RASTRO_PASSWORD
- WORKER_URL = https://me-tower-collector.meconsultconsultoria.workers.dev
- ME_TOWER_SECRET = o mesmo segredo cadastrado no Cloudflare.

Nunca escreva usuário ou senha diretamente nos arquivos.
