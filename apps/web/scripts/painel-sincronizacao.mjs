/**
 * "Modo sincronização": sobe UMA instância do painel (porta 3100 por padrão) com as EXCLUSÕES DA SINCRONIZAÇÃO HABILITADAS apenas para
 * este processo (SINCRONIZACAO_EXCLUSOES_HABILITADAS=1) e com a pasta de backup obrigatória. O `.env.local` NÃO é alterado e continua
 * com `=0`; a instância normal (porta 3000) segue bloqueada. Ao encerrar (Ctrl+C) nada permanece habilitado.
 *
 *   node scripts/painel-sincronizacao.mjs --backup-dir "<pasta durável>" [--porta 3100] [--simular]
 *
 * Observação: o Next só permite um `next dev` por projeto — encerre o painel normal antes (ou use outra cópia do projeto).
 * `--simular` só valida os argumentos e mostra o que seria feito (não sobe servidor).
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const val = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };
const simular = args.includes("--simular");
const porta = val("--porta") ?? "3100";
const dirArg = val("--backup-dir");

function sair(msg, codigo = 2) { console.error(`⛔ ${msg}`); process.exit(codigo); }

if (!dirArg) sair("informe --backup-dir <pasta durável>: sem backup recuperável não há exclusão (o disco temporário NÃO é aceito).");
const dir = resolve(dirArg);
if (dir.toLowerCase().startsWith(resolve(tmpdir()).toLowerCase())) sair(`a pasta de backup não pode ficar na pasta temporária do sistema (${tmpdir()}): ela não é durável.`);
if (!/^\d{2,5}$/.test(porta)) sair("porta inválida.");
mkdirSync(dir, { recursive: true });
const sonda = join(dir, `.sonda-escrita-${process.pid}.tmp`);
try { writeFileSync(sonda, "ok"); rmSync(sonda); } catch { sair(`sem permissão de escrita em ${dir}.`); }

console.log("════════ MODO SINCRONIZAÇÃO (exclusões HABILITADAS só nesta instância) ════════");
console.log(`  painel:  http://localhost:${porta}/importacao`);
console.log(`  backup:  ${dir}  (cada sincronização com exclusão grava aqui ANTES de excluir; restaurável com: npm run atualizar-bases -- --restaurar <backup.json>)`);
console.log("  .env.local não foi alterado. Esta instância exige: prévia → hash do plano → confirmação digitada (EXCLUIR n) → backup → transação.");
console.log("  Encerre com Ctrl+C quando terminar.");
console.log("═════════════════════════════════════════════════════════════════════════════");
if (simular) { console.log("(--simular: nenhum servidor foi iniciado)"); process.exit(0); }

const env = { ...process.env, SINCRONIZACAO_EXCLUSOES_HABILITADAS: "1", SINCRONIZACAO_BACKUP_DIR: dir };
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const filho = spawn(npx, ["next", "dev", "-p", porta], { stdio: "inherit", env, shell: process.platform === "win32" });
filho.on("exit", (c) => process.exit(c ?? 0));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => filho.kill());
