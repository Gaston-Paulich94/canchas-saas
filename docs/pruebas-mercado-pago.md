# Probar Mercado Pago en local (cuentas de prueba + túnel)

Guía para correr el flujo de cobro completo contra Mercado Pago **sin plata
real**: conectar la cuenta de un complejo, generar un link, pagarlo y ver que
el webhook lo acredite. Todo con **cuentas de prueba** de MP.

> Los paneles de Mercado Pago cambian seguido de nombre y lugar. Si algún botón
> no está donde dice la guía, buscá la sección equivalente en
> <https://www.mercadopago.com.ar/developers>.

## 0. Qué vas a necesitar

- Tu cuenta **real** de Mercado Pago, solo para entrar al panel de
  developers. No se usa para pagar ni para cobrar.
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

En el panel de developers, sección **Cuentas de prueba**, creá dos:

| Cuenta | Para qué |
|--------|----------|
| **Vendedor** | Es el complejo: con esta cuenta se hace "Conectar Mercado Pago". |
| **Comprador** | Es el cliente que paga el link. Podés cargarle saldo ficticio. |

Guardá usuario y contraseña de cada una (las genera MP). Para no mezclar
sesiones con tu cuenta real, usalas en una **ventana privada**.

## 3. La aplicación en el panel

1. **Tus integraciones → Crear aplicación.** Nombre, por ejemplo,
   "Promethix Canchas (pruebas)". Producto: **Checkout Pro**, pagos online.
2. En la configuración de la app, cargá la **URL de redireccionamiento** del
   OAuth, exacta:
   `https://tu-nombre.ngrok-free.app/api/mp/oauth/callback`
3. **Credenciales:** el `Client ID` y el `Client Secret` de la app van a
   `MP_CLIENT_ID` y `MP_CLIENT_SECRET`. El OAuth del marketplace usa los de
   **producción** de la app. Los cobros igual son de prueba, porque se hacen
   con el token del vendedor de prueba. Si el panel pide completar datos para
   activar las credenciales de producción, completalos.
4. **Webhooks → Configurar notificaciones**:
   - URL: `https://tu-nombre.ngrok-free.app/api/mp/webhooks/payment`
   - Evento: **Pagos**
   - Guardá y copiá la **clave secreta** a `MP_WEBHOOK_SECRET`.

> Si al conectar el vendedor de prueba MP rechaza la autorización por mezclar
> una app de cuenta real con un usuario de prueba, creá una tercera cuenta de
> prueba, entrá al panel con ella y armá la app desde ahí (con sus
> credenciales).

## 4. `.env`

```bash
APP_PUBLIC_URL=https://tu-nombre.ngrok-free.app
BETTER_AUTH_URL=https://tu-nombre.ngrok-free.app
MP_CLIENT_ID=...
MP_CLIENT_SECRET=...
MP_WEBHOOK_SECRET=...
```

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
| 1 | **Pagos → Conectar Mercado Pago** e ingresar con el **vendedor** de prueba | Volvés a Pagos y figura "Conectada". |
| 2 | En el panel de MP, Webhooks → **Simular notificación** | En la consola de `pnpm dev`, el webhook responde **200**. Si da **401**, la clave secreta no coincide. |
| 3 | Crear una reserva en una cancha **con precio** → **Generar link de pago** | Aparece el link y el importe es precio/hora × duración. |
| 4 | Abrir el link en ventana privada, ingresar con el **comprador** y pagar con una tarjeta de prueba aprobada | Al volver, el cobro de la reserva figura **Aprobado**. |
| 5 | Repetir con una tarjeta de prueba **rechazada** | El cobro figura **Rechazado**; el mismo link se puede reintentar. |
| 6 | Generar link, **Anular cobro** y después pagar ese link igual | MP no debería dejar pagarlo. Si lo deja, el pago queda **a devolver** y aparece el aviso. |
| 7 | Generar link y **mover la reserva** a una cancha con otro precio | El cobro pendiente queda **Cancelado**; hay que generar uno nuevo. |

**Tarjetas de prueba:** están en el panel, en **Tarjetas de prueba**. El
**nombre del titular** decide el resultado: `APRO` aprueba y `OTHE` rechaza.
Como documento usá el que indica el panel.

## 6. Si algo falla

- **"Solicitud de conexión inválida o vencida" al volver de MP:** entraste por
  localhost y volviste por el túnel, o tardaste más de lo que dura el state.
  Entrá por el túnel y reintentá.
- **El webhook responde 401:** revisá `MP_WEBHOOK_SECRET` y reiniciá `pnpm dev`.
- **El pago queda Pendiente:** fijate en la consola si llegó la notificación.
  Si no llegó, revisá que el túnel esté abierto y que la URL del panel sea
  exacta.
- **Pantalla en blanco o errores de recursos de Next por el túnel:** falta
  reiniciar `pnpm dev` después de cargar `APP_PUBLIC_URL`.

Cuando termines, volvé `APP_PUBLIC_URL` y `BETTER_AUTH_URL` a
`http://localhost:3000` y cerrá el túnel.
