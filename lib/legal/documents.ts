import 'server-only'
import type { Locale } from '@/lib/i18n/locales'

/**
 * The legal pages, as data.
 *
 * Server-only and deliberately *not* in the i18n dictionary. Those documents are
 * several thousand words that nobody interacts with, and putting them in the
 * dictionary would ship all of it — in both languages — to every visitor's browser
 * along with the button labels. Here they are read by a server component and only
 * the rendered locale crosses the wire.
 *
 * The content is written from what the code actually does, not from a template. A
 * privacy policy that describes data handling this product does not do would be a
 * worse credibility problem than the missing page it replaced — and on a landing
 * page whose entire argument is "we do not fabricate", it would be self-refuting.
 * Every claim below is traceable:
 *
 *   * per-channel consent with timestamp and source → `customers.consents`
 *   * coarsened, replaced position → `lib/wallet/geo.ts` `coarsen()`,
 *     `customer_device_positions` (primary key on `customer_id`)
 *   * no movement history → the row is upserted, never appended
 *   * erasure → `lib/gdpr/requests.ts`
 *   * signed capability links → `lib/crypto.ts`
 *   * no customer data in the service-worker cache → `public/sw.js`
 *
 * Not a substitute for review by a lawyer in the operator's jurisdiction. The
 * `disclaimer` field says so on the page, rather than leaving a reader to assume
 * otherwise.
 */

export const LEGAL_DOCUMENTS = ['privacy', 'terms', 'cookies'] as const
export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number]

export function isLegalDocument(value: unknown): value is LegalDocument {
  return typeof value === 'string' && (LEGAL_DOCUMENTS as readonly string[]).includes(value)
}

export type LegalSection = {
  heading: string
  /** Paragraphs. Rendered in order. */
  body: string[]
  /** Optional bullet list, rendered after the paragraphs. */
  bullets?: string[]
}

export type LegalContent = {
  title: string
  intro: string
  updated: string
  disclaimer: string
  sections: LegalSection[]
}

/** The date the wording last changed. Bump it when the text does. */
const LAST_UPDATED = '2026-07-31'

const CONTENT: Record<Locale, Record<LegalDocument, LegalContent>> = {
  en: {
    privacy: {
      title: 'Privacy',
      updated: LAST_UPDATED,
      intro:
        'Passimo is a loyalty platform used by local businesses. This page explains what we do with personal data, in plain terms and without exceptions hidden in the middle.',
      disclaimer:
        'This is a description of how the software behaves, written by the people who built it. It is not legal advice, and an operator running Passimo should have it reviewed for their own jurisdiction before relying on it.',
      sections: [
        {
          heading: 'Who holds your data',
          body: [
            'If you are a customer of a shop that uses Passimo, that shop is the data controller. They decided to collect your details, they decide what to send you, and they can delete you. We process the data on their behalf.',
            'If you are a business using Passimo, you are the controller for your customers’ data and we are your processor.',
          ],
        },
        {
          heading: 'What a shop collects about a customer',
          body: [
            'Only what a loyalty programme needs. Nothing is inferred from third-party data and nothing is bought.',
          ],
          bullets: [
            'An email address or a phone number — one of the two is required to identify you at the counter.',
            'A name, if you gave one.',
            'A birthday, if you gave one, used only for a birthday reward.',
            'Your visits, your balance and the rewards you have claimed.',
            'Which of the shop’s locations you enrolled at.',
            'Your consent for each channel separately — email, SMS, WhatsApp, push — with the time you gave it and where.',
          ],
        },
        {
          heading: 'Location',
          body: [
            'This is the part most worth reading carefully, because it is the part people most reasonably worry about.',
            'A shop can set a radius around each of its locations so that your loyalty card appears on your lock screen when you are nearby. On Apple Wallet and Google Wallet, that comparison happens **on your device**: the pass carries the shop’s coordinates, and your phone decides whether to surface it. Your location never leaves your phone for that.',
            'On the web version of your card, we ask before anything happens. Nothing is requested on page load; you have to tap a button whose label says what it is for. We then take **one** reading, not a continuous watch.',
            'That reading is rounded to roughly one hundred metres before it is stored, and it **replaces** the previous value rather than being added to a list. We keep one coarse position per customer so we can answer "are they near a shop right now". There is no movement history, because we never needed one and keeping it would be a liability with no benefit to you.',
            'Declining location does not break anything. You see every location the shop has, unsorted.',
          ],
        },
        {
          heading: 'Notifications',
          body: [
            'A shop can send you a message when you are near one of its locations. Every shop has a cap on how many you can receive in a day, a minimum gap between them, and quiet hours during which nothing is sent regardless of what a campaign says. The defaults are deliberately conservative.',
            'You can remove the card from your wallet at any time, and every unsubscribe link in every email works immediately and permanently.',
          ],
        },
        {
          heading: 'What we never do',
          body: ['These are architectural, not policy promises.'],
          bullets: [
            'We do not sell personal data, and we do not share it with advertisers.',
            'One shop can never see another shop’s customers. Every table is scoped by row-level security in the database, in addition to the checks in the application.',
            'We do not build a movement history from location readings.',
            'We do not store customer data in your browser’s offline cache. Staff devices are often shared, and a stale balance quoted to a customer’s face is worse than an honest "you are offline".',
            'We do not track you across other websites.',
          ],
        },
        {
          heading: 'Your rights',
          body: [
            'You can ask the shop for a copy of everything they hold about you, ask them to correct it, or ask them to erase it. Erasure is real: the record is anonymised, the identifiers are removed, and it stops being a person.',
            'Because the shop is the controller, requests go to them. If you cannot reach them, write to us and we will help.',
          ],
        },
        {
          heading: 'How long things are kept',
          body: [
            'Loyalty history is kept while your membership is active, because it is what your balance is made of. A coarse position is kept only until it is replaced by the next reading. Audit records of administrative actions are kept for accountability. Anything erased on request is gone at the point of erasure.',
          ],
        },
        {
          heading: 'Processors we use',
          body: [
            'The database is PostgreSQL, run by whoever hosts this deployment (Railway, for the hosted service). Accounts, passwords and sessions live in that same database — there is no third-party identity provider involved in signing in.',
            'Beyond it, a shop’s deployment may be configured with: Stripe (payments), Resend (email), Twilio (SMS), Meta (WhatsApp), Apple and Google (wallet passes), Google Maps (turning a shop’s address into coordinates), Anthropic (the optional AI features) and an S3-compatible bucket (uploaded images and data exports, when not stored on the deployment’s own disk).',
            'Which of these are active depends on what the operator has configured. Nothing is enabled by default beyond the database.',
          ],
        },
      ],
    },

    terms: {
      title: 'Terms',
      updated: LAST_UPDATED,
      intro:
        'The agreement between Passimo and a business using it. Written to be read, not to be survived.',
      disclaimer:
        'This is a plain-language summary of the intended commercial relationship, written by the people who built the software. It is not a substitute for a contract reviewed in your own jurisdiction.',
      sections: [
        {
          heading: 'What you get',
          body: [
            'Access to the plan you are paying for, with the limits and features published on the pricing page. Those limits are defined in one place in the software, which is the same place the API enforces them — so the pricing page cannot promise something the product refuses to do.',
          ],
        },
        {
          heading: 'The trial',
          body: [
            'Fourteen days with everything unlocked and no card required. At the end, if you have not subscribed, your workspace becomes inactive: you can still read everything, and nothing is deleted. You cannot add or change anything until you subscribe.',
            'We do not delete a workspace for non-payment. Your customers, cards, campaigns and history remain, and subscribing again restores write access to all of it.',
          ],
        },
        {
          heading: 'Paying',
          body: [
            'Plans are monthly or yearly, charged in advance through Stripe. Yearly is ten months’ price. You can cancel at any time and keep access until the end of the period you have paid for. We do not refund part-used periods, and we do not charge cancellation fees.',
            'If a card fails we do not cut you off immediately. Stripe retries, and you keep your plan through that window — losing a shop’s loyalty programme over a bank’s fraud check would be absurd.',
          ],
        },
        {
          heading: 'Your data is yours',
          body: [
            'You own your customer data. You can export it at any time, in a format you can use elsewhere. We claim no licence over it beyond what is needed to run the service you are paying for.',
          ],
        },
        {
          heading: 'What you are responsible for',
          body: ['Some of this is legal, and some of it is simply good practice.'],
          bullets: [
            'Having a lawful basis for the customer data you collect, and honouring the consent your customers give or withhold.',
            'What you send. The platform enforces frequency caps and quiet hours, but the content is yours.',
            'Your team’s access. Roles exist so a barista does not need the permissions of an owner.',
            'Not using the platform to send unsolicited marketing to people who did not opt in.',
          ],
        },
        {
          heading: 'What we are responsible for',
          body: [
            'Keeping the service running, keeping your data isolated from other businesses, and telling you plainly when something has gone wrong.',
            'We will give notice before a change that materially reduces what your plan includes.',
          ],
        },
        {
          heading: 'Support access',
          body: [
            'Our staff can, for support purposes, view your workspace as you see it. When that happens it is recorded with a reason, it expires within an hour, and it is read-only — support can see what you see but cannot act as you.',
            'The record is written to **your** audit log, not only ours. You are entitled to know when someone looked, and why.',
          ],
        },
        {
          heading: 'Limits and honesty',
          body: [
            'The service is provided as it is. We do not promise it will make you money, and we will not publish a number claiming it did until we have real ones. Our liability is limited to the fees you have paid in the preceding twelve months.',
          ],
        },
        {
          heading: 'Ending it',
          body: [
            'You can leave whenever you like, and export your data on the way out. We would only terminate an account for non-payment after the grace period, or for using the platform to send unlawful messages.',
          ],
        },
      ],
    },

    cookies: {
      title: 'Cookies',
      updated: LAST_UPDATED,
      intro:
        'Passimo uses very few cookies, and none of them are for advertising. There is no consent banner because there is nothing to consent to beyond what the product needs to work.',
      disclaimer:
        'This lists the cookies the software itself sets. An operator who adds their own analytics is responsible for disclosing those.',
      sections: [
        {
          heading: 'What we set',
          body: [],
          bullets: [
            '**`passimo_session`** — set when a merchant signs in. It holds a random session identifier signed by this deployment, nothing about you, and is readable only by the server. Without it you would be signed out on every page. Essential.',
            '**`passimo_locale`** — the language you chose. Read on the server so the first byte of every page is already in the right language. Kept for a year. Essential to the feature; harmless without it, since it falls back to your browser’s language.',
            '**Theme** — light or dark. Stored locally, not sent anywhere.',
            '**`passimo_impersonation`** — only ever set for our own support staff, only while viewing a merchant’s workspace, and expires within an hour.',
          ],
        },
        {
          heading: 'What we do not set',
          body: [
            'No advertising cookies. No cross-site tracking. No third-party pixels. Nothing that follows you to another website.',
          ],
        },
        {
          heading: 'Turning them off',
          body: [
            'You can block cookies in your browser. Authentication will stop working — there is no way for a signed-in session to exist without one — but the public pages, a customer’s own loyalty card, and the enrolment flow all work fine.',
          ],
        },
      ],
    },
  },

  es: {
    privacy: {
      title: 'Privacidad',
      updated: LAST_UPDATED,
      intro:
        'Passimo es una plataforma de fidelización que usan negocios locales. Esta página explica qué hacemos con los datos personales, en lenguaje claro y sin excepciones escondidas a mitad del texto.',
      disclaimer:
        'Esta es una descripción de cómo se comporta el software, escrita por quienes lo hemos construido. No es asesoramiento legal, y quien opere Passimo debería revisarla para su propia jurisdicción antes de basarse en ella.',
      sections: [
        {
          heading: 'Quién tiene tus datos',
          body: [
            'Si eres cliente de una tienda que usa Passimo, esa tienda es la responsable del tratamiento. Ella decidió recoger tus datos, ella decide qué enviarte y ella puede borrarte. Nosotros tratamos los datos por su cuenta.',
            'Si eres un negocio que usa Passimo, tú eres el responsable de los datos de tus clientes y nosotros somos tu encargado del tratamiento.',
          ],
        },
        {
          heading: 'Qué recoge una tienda sobre un cliente',
          body: [
            'Solo lo que necesita un programa de fidelización. No inferimos nada a partir de datos de terceros y no compramos nada.',
          ],
          bullets: [
            'Un email o un teléfono: hace falta uno de los dos para identificarte en el mostrador.',
            'Un nombre, si lo has dado.',
            'Un cumpleaños, si lo has dado, usado solo para un regalo de cumpleaños.',
            'Tus visitas, tu saldo y las recompensas que has canjeado.',
            'En cuál de los locales de la tienda te diste de alta.',
            'Tu consentimiento por cada canal por separado —email, SMS, WhatsApp, push— con la hora en que lo diste y desde dónde.',
          ],
        },
        {
          heading: 'Ubicación',
          body: [
            'Esta es la parte que más merece la pena leer con calma, porque es la que más razonablemente preocupa a la gente.',
            'Una tienda puede definir un radio alrededor de cada local para que tu tarjeta aparezca en tu pantalla de bloqueo cuando estás cerca. En Apple Wallet y Google Wallet esa comparación ocurre **en tu dispositivo**: la tarjeta lleva las coordenadas de la tienda y tu móvil decide si la muestra. Tu ubicación no sale del móvil para eso.',
            'En la versión web de tu tarjeta preguntamos antes de hacer nada. No se pide nada al cargar la página: tienes que pulsar un botón cuyo texto dice para qué es. Después tomamos **una** lectura, no un seguimiento continuo.',
            'Esa lectura se redondea a unos cien metros antes de guardarse, y **sustituye** al valor anterior en lugar de añadirse a una lista. Guardamos una única posición aproximada por cliente para poder responder «¿está ahora cerca de una tienda?». No hay historial de movimientos, porque nunca lo hemos necesitado y guardarlo sería un riesgo sin ningún beneficio para ti.',
            'Rechazar la ubicación no rompe nada. Ves todos los locales de la tienda, sin ordenar.',
          ],
        },
        {
          heading: 'Avisos',
          body: [
            'Una tienda puede enviarte un mensaje cuando estás cerca de uno de sus locales. Cada tienda tiene un máximo de avisos por día, un intervalo mínimo entre ellos y un horario de silencio en el que no se envía nada, diga lo que diga la campaña. Los valores por defecto son deliberadamente prudentes.',
            'Puedes eliminar la tarjeta de tu wallet cuando quieras, y cualquier enlace para darse de baja en cualquier email funciona de inmediato y para siempre.',
          ],
        },
        {
          heading: 'Lo que nunca hacemos',
          body: ['Esto es arquitectura, no promesas.'],
          bullets: [
            'No vendemos datos personales ni los compartimos con anunciantes.',
            'Una tienda nunca puede ver los clientes de otra. Cada tabla está aislada por seguridad a nivel de fila en la base de datos, además de las comprobaciones de la aplicación.',
            'No construimos un historial de movimientos con las lecturas de ubicación.',
            'No guardamos datos de clientes en la caché offline de tu navegador. Los dispositivos del mostrador se comparten, y decirle a un cliente un saldo desactualizado a la cara es peor que un honesto «no hay conexión».',
            'No te seguimos por otras webs.',
          ],
        },
        {
          heading: 'Tus derechos',
          body: [
            'Puedes pedir a la tienda una copia de todo lo que tiene sobre ti, pedir que lo corrija o pedir que lo borre. El borrado es real: el registro se anonimiza, los identificadores se eliminan y deja de ser una persona.',
            'Como la responsable es la tienda, las solicitudes van a ella. Si no consigues contactarla, escríbenos y te ayudamos.',
          ],
        },
        {
          heading: 'Cuánto tiempo se guarda',
          body: [
            'El historial de fidelización se guarda mientras tu alta esté activa, porque es de lo que está hecho tu saldo. Una posición aproximada se guarda solo hasta que la sustituye la siguiente lectura. Los registros de auditoría de acciones administrativas se conservan por responsabilidad. Lo que se borra a petición desaparece en ese momento.',
          ],
        },
        {
          heading: 'Proveedores que usamos',
          body: [
            'La base de datos es PostgreSQL y la gestiona quien aloja esta instalación (Railway, en el servicio alojado). Las cuentas, las contraseñas y las sesiones viven en esa misma base de datos: no hay ningún proveedor de identidad externo en el inicio de sesión.',
            'Aparte de eso, la instalación de una tienda puede estar configurada con: Stripe (pagos), Resend (email), Twilio (SMS), Meta (WhatsApp), Apple y Google (tarjetas wallet), Google Maps (convertir la dirección de una tienda en coordenadas), Anthropic (las funciones de IA, opcionales) y un bucket compatible con S3 (las imágenes subidas y las exportaciones de datos, cuando no se guardan en el disco de la propia instalación).',
            'Cuáles están activos depende de lo que haya configurado quien opera la plataforma. Nada está activado por defecto más allá de la base de datos.',
          ],
        },
      ],
    },

    terms: {
      title: 'Términos',
      updated: LAST_UPDATED,
      intro:
        'El acuerdo entre Passimo y un negocio que lo usa. Escrito para leerse, no para sobrevivirlo.',
      disclaimer:
        'Este es un resumen en lenguaje claro de la relación comercial que pretendemos, escrito por quienes hemos hecho el software. No sustituye a un contrato revisado en tu jurisdicción.',
      sections: [
        {
          heading: 'Qué obtienes',
          body: [
            'Acceso al plan que estás pagando, con los límites y funciones publicados en la página de precios. Esos límites se definen en un único lugar del software, que es el mismo que la API aplica, así que la página de precios no puede prometer algo que el producto se niegue a hacer.',
          ],
        },
        {
          heading: 'La prueba',
          body: [
            'Catorce días con todo desbloqueado y sin tarjeta. Al terminar, si no te has suscrito, tu espacio pasa a inactivo: puedes seguir leyendo todo y no se borra nada. No puedes añadir ni cambiar nada hasta que te suscribas.',
            'No borramos un espacio por impago. Tus clientes, tarjetas, campañas e historial siguen ahí, y al volver a suscribirte recuperas el acceso de escritura a todo.',
          ],
        },
        {
          heading: 'Pagar',
          body: [
            'Los planes son mensuales o anuales, cobrados por adelantado a través de Stripe. El anual cuesta diez meses. Puedes cancelar cuando quieras y mantienes el acceso hasta el final del periodo que has pagado. No devolvemos periodos empezados y no cobramos por cancelar.',
            'Si una tarjeta falla no te cortamos de inmediato. Stripe reintenta y mantienes tu plan durante ese margen: perder el programa de fidelización de una tienda por una comprobación antifraude de un banco sería absurdo.',
          ],
        },
        {
          heading: 'Tus datos son tuyos',
          body: [
            'Los datos de tus clientes son tuyos. Puedes exportarlos cuando quieras, en un formato que puedas usar en otro sitio. No reclamamos ninguna licencia sobre ellos más allá de lo necesario para ofrecerte el servicio que pagas.',
          ],
        },
        {
          heading: 'De qué te encargas tú',
          body: ['Parte de esto es legal y parte es simplemente hacer las cosas bien.'],
          bullets: [
            'Tener una base legal para los datos de clientes que recoges, y respetar el consentimiento que te dan o te niegan.',
            'Lo que envías. La plataforma aplica límites de frecuencia y horarios de silencio, pero el contenido es tuyo.',
            'El acceso de tu equipo. Los roles existen para que un camarero no necesite los permisos de un propietario.',
            'No usar la plataforma para enviar publicidad a quien no la ha pedido.',
          ],
        },
        {
          heading: 'De qué nos encargamos nosotros',
          body: [
            'De mantener el servicio en marcha, de mantener tus datos aislados de otros negocios y de decirte claramente cuando algo ha ido mal.',
            'Avisaremos antes de un cambio que reduzca de forma significativa lo que incluye tu plan.',
          ],
        },
        {
          heading: 'Acceso de soporte',
          body: [
            'Nuestro equipo puede, por soporte, ver tu espacio como lo ves tú. Cuando ocurre queda registrado con un motivo, caduca en menos de una hora y es solo lectura: soporte ve lo que ves, pero no puede actuar por ti.',
            'El registro se escribe en **tu** propio historial de auditoría, no solo en el nuestro. Tienes derecho a saber cuándo alguien ha mirado, y por qué.',
          ],
        },
        {
          heading: 'Límites y honestidad',
          body: [
            'El servicio se ofrece tal como está. No prometemos que vayas a ganar dinero, y no publicaremos una cifra afirmando que lo hicimos hasta que tengamos cifras reales. Nuestra responsabilidad se limita a las cuotas que hayas pagado en los doce meses anteriores.',
          ],
        },
        {
          heading: 'Terminar',
          body: [
            'Puedes irte cuando quieras y exportar tus datos al salir. Solo cancelaríamos una cuenta por impago tras el periodo de gracia, o por usar la plataforma para enviar mensajes ilícitos.',
          ],
        },
      ],
    },

    cookies: {
      title: 'Cookies',
      updated: LAST_UPDATED,
      intro:
        'Passimo usa muy pocas cookies, y ninguna es de publicidad. No hay banner de consentimiento porque no hay nada que consentir más allá de lo que el producto necesita para funcionar.',
      disclaimer:
        'Aquí se listan las cookies que pone el propio software. Quien lo opere y añada su propia analítica es responsable de declararla.',
      sections: [
        {
          heading: 'Las que ponemos',
          body: [],
          bullets: [
            '**`passimo_session`**: se pone cuando un negocio inicia sesión. Contiene un identificador de sesión aleatorio firmado por esta instalación, nada sobre ti, y solo lo puede leer el servidor. Sin ella se cerraría tu sesión en cada página. Imprescindible.',
            '**`passimo_locale`**: el idioma que elegiste. Se lee en el servidor para que el primer byte de cada página ya esté en el idioma correcto. Se guarda un año. Imprescindible para esa función; sin ella no pasa nada, se usa el idioma de tu navegador.',
            '**Tema**: claro u oscuro. Se guarda en local y no se envía a ningún sitio.',
            '**`passimo_impersonation`**: solo se pone para nuestro equipo de soporte, solo mientras ve el espacio de un negocio, y caduca en menos de una hora.',
          ],
        },
        {
          heading: 'Las que no ponemos',
          body: [
            'Ninguna cookie de publicidad. Ningún seguimiento entre sitios. Ningún píxel de terceros. Nada que te siga a otra web.',
          ],
        },
        {
          heading: 'Desactivarlas',
          body: [
            'Puedes bloquear las cookies en tu navegador. La autenticación dejará de funcionar —no hay forma de mantener una sesión iniciada sin ella— pero las páginas públicas, la tarjeta de un cliente y el alta funcionan igual.',
          ],
        },
      ],
    },
  },
}

export function getLegalContent(document: LegalDocument, locale: Locale): LegalContent {
  return CONTENT[locale][document]
}
