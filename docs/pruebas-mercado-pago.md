# Probar Mercado Pago en local (cuentas de prueba + túnel)

Guía para correr el flujo de cobro completo contra Mercado Pago **sin plata
real**: conectar la cuenta de un complejo, generar un link, pagarlo y ver que
el webhook lo acredite. Todo con **cuentas de prueba** de MP.

> Los paneles de Mercado Pago cambian seguido de nombre y lugar. Si algún botón
> no está donde dice la guía, buscá la sección equivalente en
> <https://www.mercadopago.com.ar/developers>.

## 0. Qué vas a necesitar

- Tu cuenta **real** de Mercado Pago, solo para entrar al panel de
  developers y crear las cuentas de prueba. No se usa para pagar, cobrar ni
  para la aplicación.
- Una cuenta gratuita de **ngrok** (el túnel).
- La app corriendo en local (`pnpm dev`) con la base levantada.

Nada de esto se commitea: los valores van en `.env`, que está en `.gitignore`.
**No pegues credenciales en el chat ni en issues**; si algo falla, alcanza con
el mensaje de error y la línea del log, sin tokens.

## 1. El túnel (una URL pública fija)

Mercado Pago tiene que poder llegar a tu máquina: lo usan la vuelta del OAuth
y el webhook. Conviene **ngrok con dominio fijo**, porque esa URL se carga en
el panel de MP y en `.env`, y así no hay que cambiarla en cada prueba.

1. Creá la cuenta en <https://ngrok.com> e instalalo (`winget install ngrok.ngrok`).
2. Copiá tu authtoken del dashboard de ngrok y registralo:
   `ngrok config add-authtoken <tu-authtoken>`
3. En el dashboard, sección **Domains**, reclamá el dominio gratuito
   (algo como `tu-nombre.ngrok-free.app`).
4. Con la app corriendo, abrí el túnel:
   `ngrok http 3000 --url=https://tu-nombre.ngrok-free.app`

Alternativa sin cuenta: `cloudflared tunnel --url http://localhost:3000`. Da
una URL `*.trycloudflare.com` **distinta cada vez**, así que en cada prueba
hay que actualizar `.env` y el panel de MP.

> El plan gratis de ngrok muestra una pantalla de aviso la primera vez que
> abrís la URL desde el navegador: tocá *Visit Site*. A los pedidos de MP
> (webhook) no les afecta.

## 2. Cuentas de prueba

Entrá al panel de developers con tu cuenta real y andá a **Integraciones →
Cuentas de prueba → Crear nueva cuenta**. Para un marketplace, MP pide
**tres**, todas con país **Argentina** (no se puede cambiar después):

| Tipo | Descripción sugerida | Para qué |
|------|----------------------|----------|
| **Integrador** | "Integrador - Promethix" | Es la dueña de la **aplicación**: representa a la plataforma. |
| **Vendedor** | "Vendedor - complejo demo" | Es el complejo: con esta cuenta se hace "Conectar Mercado Pago". |
| **Comprador** | "Comprador - cliente" | Es el cliente que paga el link. Cargale un **saldo ficticio** alto (por ejemplo, $500.000). |

Por cada una, MP genera **usuario**, **contraseña** y un **código de
verificación** de 6 dígitos, que pide a veces al iniciar sesión. Anotalos en
un lugar seguro, fuera del repo. Las cuentas de prueba **no se pueden borrar**
y el máximo es 15.

Usá cada cuenta de prueba en su **propia ventana privada**, para no mezclar
sesiones con tu cuenta real ni entre ellas.

## 3. La aplicación en el panel

Todo este paso se hace **logueado con la cuenta Integrador de prueba**, en
una ventana privada (entrá a <https://www.mercadopago.com.ar/developers> con
su usuario y contraseña).

1. **Tus integraciones → Crear aplicación.** Nombre, por ejemplo,
   "Promethix Canchas (pruebas)". Producto: **Checkout Pro**, pagos online.
2. En la configuración de la app, cargá la **URL de redireccionamiento** del
   OAuth, exacta:
   `https://tu-nombre.ngrok-free.app/api/mp/oauth/callback`
3. **Credenciales:** el número de la aplicación (**Client ID** o **App ID**) y
   el **Client Secret** van a `MP_CLIENT_ID` y `MP_CLIENT_SECRET`. Son los de
   **producción** de la app del Integrador. Los cobros igual son de prueba,
   porque todas las cuentas involucradas son de prueba. Si el panel pide
   completar datos para activar las credenciales de producción, completalos.
4. **Webhooks → Configurar notificaciones**:
   - URL: `https://tu-nombre.ngrok-free.app/api/mp/webhooks/payment`
   - Evento: **Pagos**
   - Guardá y copiá la **clave secreta** a `MP_WEBHOOK_SECRET`.

## 4. `.env`

```bash
APP_PUBLIC_URL=https://tu-nombre.ngrok-free.app
BETTER_AUTH_URL=https://tu-nombre.ngrok-free.app
MP_CLIENT_ID=...
MP_CLIENT_SECRET=...
MP_WEBHOOK_SECRET=...
MP_MARKETPLACE_FEE_PERCENT=0
```

Empezá con la comisión en **0**. Cuando el flujo básico ande, probá con una
comisión (por ejemplo `10`) para ver que MP la retenga.

Reiniciá `pnpm dev` después de cambiar `.env`: `next.config.ts` habilita el
dominio de `APP_PUBLIC_URL` en el dev server al arrancar.

**Durante las pruebas entrá a la app por la URL del túnel**, no por
`localhost:3000`. La sesión vive en una cookie del dominio con el que
entraste, y la vuelta del OAuth llega al dominio del túnel: si entraste por
localhost, ahí no vas a tener sesión.

## 5. Prueba de punta a punta

Entrá por el túnel como `dueno@demo.test`, con la contraseña de
`DEMO_PASSWORD`.

| # | Qué hacer | Qué tiene que pasar |
|---|-----------|---------------------|
| 1 | **Pagos → Conectar Mercado Pago**, ingresar con el **Vendedor** de prueba y **autorizar** (de una: el código de autorización vence a los 10 minutos) | Volvés a Pagos y figura "Conectada". |
| 2 | En el panel de MP, Webhooks → **Simular notificación** | En la consola de `pnpm dev`, el webhook responde **200**. Si da **401**, la clave secreta no coincide. |
| 3 | Crear una reserva en una cancha **con precio** → **Generar link de pago** | Aparece el link y el importe es precio/hora × duración. |
| 4 | Abrir el link en una ventana privada, ingresar con el **Comprador** y pagar con **dinero en cuenta** (el saldo ficticio) | Al volver, el cobro de la reserva figura **Aprobado**. |
| 5 | Generar otro link y pagarlo con una **tarjeta de prueba rechazada** | El cobro figura **Rechazado** y el mismo link se puede reintentar. Si MP no ofrece tarjeta, ver la nota de abajo. |
| 6 | Generar link, **Anular cobro** y después pagar ese link igual | MP no debería dejar pagarlo. Si lo deja, el pago queda **a devolver** y aparece el aviso. |
| 7 | Generar link y **mover la reserva** a una cancha con otro precio | El cobro pendiente queda **Cancelado**; hay que generar uno nuevo. |

**Dinero en cuenta o tarjeta.** En un marketplace con split de pagos, MP
documenta que solo se puede pagar con **dinero en cuenta** de Mercado Pago.
Por eso el paso 4 usa el saldo del Comprador. Si en el checkout aparece la
opción de tarjeta, las de prueba están en el panel, en **Tarjetas de prueba**.
El **nombre del titular** decide el resultado: `APRO` aprueba y `OTHE`
rechaza. Como documento usá el que indica el panel.

## 6. Si algo falla

- **"Solicitud de conexión inválida o vencida" al volver de MP:** entraste por
  localhost y volviste por el túnel, o tardaste más de lo que dura el state.
  Entrá por el túnel y reintentá.
- **MP rechaza la autorización o el intercambio del código** (error al volver
  a Pagos): confirmá que la app es de la cuenta **Integrador** y que conectás
  con la **Vendedor**. Si sigue fallando, avisame: MP permite pedir
  credenciales de sandbox con el parámetro `test_token`, y habría que
  agregarlo al código.
- **El webhook responde 401:** revisá `MP_WEBHOOK_SECRET` y reiniciá `pnpm dev`.
- **El pago queda Pendiente:** fijate en la consola si llegó la notificación.
  Si no llegó, revisá que el túnel esté abierto y que la URL del panel sea
  exacta.
- **`pnpm dev` (o `pnpm build`) se corta con "Your version of Next.js is
  affected by a known security vulnerability":** es un aviso del CLI de Next
  que aparece de a ratos mientras haya advisories sin aplicar. No es un error
  de la app: volvé a correr el mismo comando y sigue.
- **Pantalla en blanco o errores de recursos de Next por el túnel:** falta
  reiniciar `pnpm dev` después de cargar `APP_PUBLIC_URL`.

Cuando termines, volvé `APP_PUBLIC_URL` y `BETTER_AUTH_URL` a
`http://localhost:3000` y cerrá el túnel.
