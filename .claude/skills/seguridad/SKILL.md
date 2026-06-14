---
name: seguridad
description: Revisión integral de seguridad del código ante todo tipo de vulnerabilidades conocidas (OWASP Top 10 2025, OWASP ASVS, API Security Top 10, CWE Top 25, Proactive Controls, riesgos de código generado por IA y cadena de suministro). Usá este skill SIEMPRE que se cierre una feature, se abra un PR, se escriba o modifique código que toque autenticación, autorización, datos de usuario, pagos, webhooks, queries a la DB, llamadas externas o configuración. Disparalo aunque el usuario no mencione la palabra "seguridad": cualquier código que entre al repo pasa por acá antes de darse por terminado.
---

# Seguridad integral del código

Este skill garantiza que el código sea seguro ante vulnerabilidades conocidas
hasta la fecha, no solo el OWASP Top 10. El Top 10 es un documento de
concientización, no un estándar completo; por eso acá nos apoyamos en estándares
más exhaustivos y los aplicamos al stack concreto del proyecto.

## Cuándo correr este skill

- Al cerrar cualquier feature (parte del Definition of Done).
- Antes de mergear un PR.
- Cada vez que se toca: auth, autorización, datos de usuario/PII, pagos,
  webhooks, queries a la DB, llamadas a servicios externos, o configuración.
- Cuando el usuario lo pida explícitamente.

## Estándares de referencia

Aplicá, en este orden de prioridad práctica:

1. **OWASP Top 10 2025** — baseline de concientización (mapeado abajo).
2. **OWASP ASVS (edición vigente)** — el estándar de verificación más completo;
   es la fuente de verdad cuando una decisión no está cubierta por el Top 10.
3. **OWASP API Security Top 10** — porque exponemos route handlers y webhooks.
4. **OWASP Proactive Controls** — controles positivos (qué hacer, no solo qué evitar).
5. **CWE Top 25 (edición vigente)** — las debilidades de software más peligrosas.
6. **OWASP Cheat Sheet Series** — guía de implementación concreta por tema.

Si una verificación no está clara con el Top 10, escalá a ASVS antes de decidir.

## Checklist integral (por categoría)

Revisá el código contra cada categoría. Marcá cada una como PASA / FALLA /
N/A con la justificación.

### 1. Control de acceso y multi-tenant (OWASP A01, incl. SSRF)

Es el riesgo #1 de esta app. Verificá:
- TODA query lleva el `tenant_id` de la sesión; nunca uno provisto por el cliente.
- Autorización en el service layer (no solo en la UI). Chequear permisos por rol
  (owner / staff / cliente) en cada use-case.
- No hay IDOR: pedir el recurso por id siempre valida que pertenezca al tenant.
- RLS de Postgres activo como defensa en profundidad.
- SSRF: toda URL saliente (webhooks, Google Maps, etc.) pasa por una allowlist;
  nunca se hace fetch a una URL armada con input del usuario sin validar.

### 2. Autenticación y sesiones (A07)

- better-auth con configuración de sesión segura (cookies httpOnly, secure,
  sameSite; expiración y rotación razonables).
- Rate limiting y backoff en login y endpoints sensibles (anti fuerza bruta).
- Política de contraseñas y, donde aplique, MFA opcional.
- Nunca exponer si un email existe (mensajes de error genéricos en login/reset).

### 3. Validación de entrada e inyección (A05)

- Zod valida y tipa TODO input en el borde (forms, actions, API, webhooks).
- SQL: solo queries parametrizadas vía Drizzle. Prohibido construir SQL por
  concatenación de strings.
- XSS: confiar en el escape por defecto de React; jamás `dangerouslySetInnerHTML`
  con contenido no sanitizado.
- Command injection / path traversal: no pasar input a comandos del SO ni a rutas
  de archivo sin validar/normalizar.
- Deserialización: no deserializar datos no confiables en estructuras ejecutables.

### 4. Criptografía y secretos (A04)

- Secretos solo en variables de entorno; nunca en el repo. `.env` en `.gitignore`,
  `.env.example` sin valores reales.
- Tokens OAuth de Mercado Pago cifrados at-rest (no en texto plano en la DB).
- TLS en todos lados (Caddy en prod). Nada de HTTP en producción.
- Hashing correcto de credenciales (lo maneja better-auth; verificar que no se
  guarde nada sensible reversible).
- Escaneo de secretos filtrados en el repo (gitleaks o trufflehog).

### 5. Configuración segura (A02)

- Headers de seguridad: CSP (con nonces en Next.js), HSTS, X-Content-Type-Options,
  Referrer-Policy, Permissions-Policy.
- CORS restrictivo: solo orígenes necesarios.
- Sin `debug`/stack traces ni mensajes verbosos en producción.
- Rol de DB con mínimo privilegio (no usar superusuario desde la app).

### 6. Cadena de suministro (A03 — nuevo en 2025)

La cadena de suministro es el nuevo perímetro, y más con código generado por IA.
- `pnpm` con lockfile commiteado; instalar con `--frozen-lockfile` en CI.
- Escaneo de dependencias con **Snyk** y `pnpm audit`; Dependabot/Renovate para updates.
- Imágenes Docker (app, Postgres, n8n, Evolution, Redis, Caddy) pinneadas por
  digest, no por tag mutable; escanearlas con Trivy.
- SBOM generado para releases.

### 7. Integridad de datos y software (A08)

- Webhooks (Mercado Pago, WhatsApp): verificar SIEMPRE la firma. El webhook es la
  única fuente de verdad del pago; nunca confiar en el redirect del frontend.
- CI con checks obligatorios (typecheck, lint, tests, escaneo de seguridad).
- Integridad del lockfile y de los artefactos de build.

### 8. Manejo de errores y condiciones excepcionales (A10 — nuevo en 2025)

- Nunca "fallar abierto": si una verificación de autorización falla o lanza
  excepción, el resultado por defecto es DENEGAR.
- Capturar y manejar errores de servicios externos (MP, WhatsApp, DB) sin tumbar
  la app ni dejar estados inconsistentes.
- Respuestas de error genéricas al cliente; el detalle va al log interno.

### 9. Logging, alertas y auditoría (A09)

- Logging estructurado de eventos de seguridad (login, cambios de rol, pagos).
- Audit trail de operaciones sensibles (quién hizo qué y cuándo).
- NUNCA loguear secretos, tokens, contraseñas ni PII.
- Alertas sobre patrones sospechosos (picos de fallos de login, etc.).

### 10. Seguridad específica del stack

- **Next.js**: autorización en cada Server Action y route handler (no asumir que
  estar logueado alcanza). Mantener Next.js actualizado: hubo advisories de bypass
  de middleware/proxy y de SSRF que se arreglan upgradeando.
- **Drizzle**: queries parametrizadas, sin SQL crudo con input.
- **Mercado Pago**: OAuth por tenant, verificación de firma del webhook, montos
  validados en el backend (nunca confiar en el monto que manda el front).
- **Evolution API / WhatsApp**: en modo Baileys (MVP) asumir riesgo de ban y no
  usar un número de producción; en prod, Cloud API oficial con plantillas aprobadas.
- **Docker (prod)**: contenedores con usuario no-root, secretos vía variables de
  entorno o secrets, red interna entre servicios, solo Caddy expuesto.

### 11. Riesgos del código generado por IA

Como buena parte del código lo genera un asistente, revisá específicamente:
- **Paquetes alucinados (slopsquatting)**: verificar que toda dependencia sugerida
  EXISTE y es legítima (descargas, mantenimiento, repo real) antes de instalarla.
- **Defaults inseguros**: la IA tiende a generar código plausible pero a veces
  inseguro (ej. CORS abierto, validación faltante, secretos hardcodeados de ejemplo).
- **Secretos de ejemplo**: que no queden claves o tokens de prueba en el código.

## Salida esperada

Producí un reporte de revisión con este formato:

```
## Revisión de seguridad — <feature>
Resultado: APROBADO / RECHAZADO

| Categoría | Estado | Hallazgo / acción |
|-----------|--------|-------------------|
| 1. Acceso/multi-tenant | PASA/FALLA/N/A | ... |
| ... | ... | ... |

### Hallazgos a corregir (si los hay)
- [crítico/alto/medio/bajo] <descripción> → <fix concreto>
```

Si hay hallazgos críticos o altos, la feature NO está terminada: corregir y
re-revisar antes de cerrar.

## Herramientas a correr cuando estén disponibles

- `pnpm audit` y **Snyk** — dependencias
- `gitleaks` / `trufflehog` — secretos en el repo
- `semgrep` — SAST sobre el código
- `trivy` — imágenes Docker

## Nota de mantenimiento

A medida que este skill crezca, mové el detalle profundo de cada estándar a
`references/` (ej. `references/asvs.md`, `references/owasp-2025.md`) y dejá en
este SKILL.md el workflow + el checklist + los punteros. Eso es progressive
disclosure: el modelo carga solo lo que necesita.
