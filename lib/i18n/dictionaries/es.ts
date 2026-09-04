import type { Dictionary } from '@/lib/i18n/dictionaries/en'

/**
 * Spanish (Spain).
 *
 * Typed as `Dictionary`, so a key present in English and missing here is a build
 * error. That is the mechanism behind "the app never mixes languages": it is not a
 * review convention, it is `pnpm typecheck`.
 *
 * Written as a Spanish speaker would say it, not as a translation of the English.
 * Where the two languages phrase something differently — *"te devuelve el cliente"*
 * rather than *"brings the customer back"* — the Spanish wins in the Spanish file.
 */
export const es: Dictionary = {
  common: {
    appName: 'Passimo',
    tagline: 'La plataforma de fidelización digital para negocios locales',
    save: 'Guardar',
    saving: 'Guardando…',
    saved: 'Guardado',
    cancel: 'Cancelar',
    close: 'Cerrar',
    delete: 'Eliminar',
    edit: 'Editar',
    add: 'Añadir',
    remove: 'Quitar',
    back: 'Atrás',
    next: 'Siguiente',
    done: 'Listo',
    search: 'Buscar',
    loading: 'Cargando…',
    retry: 'Reintentar',
    optional: 'Opcional',
    required: 'Obligatorio',
    enabled: 'Activado',
    disabled: 'Desactivado',
    active: 'Activa',
    inactive: 'Inactiva',
    paused: 'En pausa',
    draft: 'Borrador',
    all: 'Todos',
    none: 'Ninguno',
    yes: 'Sí',
    no: 'No',
    perMonth: '/mes',
    perYear: '/año',
    metres: '{value} m',
    kilometres: '{value} km',
    minutes_one: '{count} minuto',
    minutes_other: '{count} minutos',
    hours_one: '{count} hora',
    hours_other: '{count} horas',
    days_one: '{count} día',
    days_other: '{count} días',
    somethingWentWrong: 'Algo ha ido mal',
    tryAgainOrContact: 'Inténtalo de nuevo, y escríbenos si sigue ocurriendo.',
    comingSoon: 'Próximamente',
    learnMore: 'Saber más',
    preview: 'Vista previa',
    upgradeRequired: 'Requiere otro plan',
    upgradeToUse: 'Disponible desde {plan}',
    language: 'Idioma',
    theme: 'Tema',
    copy: 'Copiar',
    copied: 'Copiado',
    clear: 'Borrar',
    dismiss: 'Descartar',
    open: 'Abrir',
    status: 'Estado',
    previous: 'Anterior',
    never: 'Nunca',
    ready: 'Listo',
    notConfigured: 'Sin configurar',
    couldNotSave: 'No hemos podido guardarlo',
    saveChanges: 'Guardar cambios',
    downloadForPrint: 'Descargar para imprimir',
    archived: 'Archivado',
    anonymous: 'Anónimo',
    seeAll: 'Ver todo',
  },

  nav: {
    features: 'Características',
    howItWorks: 'Cómo funciona',
    pricing: 'Precios',
    compare: 'Comparar',
    demo: 'Demo en vivo',
    wallet: 'La tarjeta',
    login: 'Iniciar sesión',
    getStarted: 'Empezar prueba gratis',
    openMenu: 'Abrir menú',
    closeMenu: 'Cerrar menú',
  },

  /**
   * Onboarding: tres pasos obligatorios y nada más.
   *
   * El negocio se crea en el registro (nombre, sector, zona horaria), así que el
   * asistente sólo pide lo que hace falta para atender a alguien: un plan, un
   * sitio y una tarjeta. Todo lo demás vive ahora en la checklist del panel.
   */
  onboarding: {
    progressLabel: 'Progreso de la configuración',
    progressTitle: 'Tu programa de fidelización',
    progressPercent: '{percent}% completado',
    saveFailed: 'No hemos podido guardarlo. Inténtalo de nuevo.',
    steps: {
      program: 'Tu programa',
      plan: 'Tu plan',
      shop: 'Tu local',
      location: 'Tu local',
      card: 'Tu tarjeta',
    },
    units: {
      stamp: 'sello',
      stamps: 'sellos',
      point: 'punto',
      points: 'puntos',
    },
    program: {
      title: 'Este es tu programa, {businessName}',
      subtitle:
        'Montado a partir del tipo de negocio que tienes. Todo esto es un punto de partida: cámbialo ahora o más adelante.',
      programName: 'Recompensas de {business}',
      rowProgram: 'Cómo lo consiguen',
      rowReward: 'Qué se llevan',
      rowCampaign: 'Tu primera campaña',
      stampsSummary: 'Un sello por visita, {goal} sellos por recompensa',
      pointsSummary: 'Un punto por unidad gastada, {goal} puntos por recompensa',
      notYourTrade: '¿No es exactamente eso?',
      notYourTradeHint: 'Elige el más parecido y todo lo de arriba se actualiza.',
      continue: 'Me encaja',
      /* La primera campaña que se paga sola en cada sector. Concreta, porque
         «lanza una campaña» no significa nada para quien nunca ha lanzado una. */
      campaigns: {
        cafe: 'Sellos dobles antes de las 10, para crear el hábito de la mañana',
        restaurant: 'Un postre de cumpleaños, enviado la semana anterior',
        bakery: 'Un aviso de «recién salido del horno» a los habituales que pasen cerca',
        barber: 'Un recordatorio a las cuatro semanas, cuando toca cortarse el pelo',
        beauty: 'Un detalle para quien no reserva desde hace dos meses',
        gym: 'Una recompensa a las diez visitas, cuando el hábito se asienta',
        retail: 'Acceso anticipado a las rebajas, solo para socios',
        bar: 'Una ronda invitada a las ocho visitas',
        pet: 'Un recordatorio cuando se les acaba el pienso que compran',
        other: 'Una oferta de reactivación tras treinta días sin pasar',
      },
    },
    plan: {
      title: 'Elige un plan, {businessName}',
      subtitle:
        'Todos los planes incluyen 14 días de prueba con todo desbloqueado, y no hace falta tarjeta para empezar.',
      continueTrial: 'Empezar mi prueba de 14 días',
      continueTrialHint:
        'Ya estás en la prueba. Elige plan cuando quieras: hoy no deja de funcionar nada.',
      choose: 'Elegir {plan}',
      chosen: 'Elegido',
      recommended: 'Recomendado para ti',
      notConfigured:
        'El pago online no está configurado en este despliegue, así que tu prueba continúa sin más. Puedes cambiar de plan desde la pantalla de facturación cuando quieras.',
    },
    location: {
      title: '¿Dónde te encuentran tus clientes?',
      subtitle:
        'Con un local basta para empezar. Es a lo que apunta la tarjeta y desde donde se mide el geoperímetro más adelante.',
      nameHint: 'Como lo llaman tus clientes: el rótulo de la puerta.',
      addressHint:
        'Las coordenadas son opcionales ahora. Añádelas más tarde y se activan los avisos por cercanía.',
      skipCoordinates: 'Añadiré la ubicación exacta más tarde',
      skip: 'Sáltalo: añadiré mi local más tarde',
      createFailed: 'No hemos podido guardar tu local. Inténtalo de nuevo.',
    },
    /** Página pública de alta: el único punto de conversión del producto. */
  card: {
      title: 'Activa tu tarjeta de fidelización',
      subtitle:
        'Hemos prellenado una recompensa y unos colores que encajan con tu sector. Cámbialos o acéptalos: en cualquier caso, se activa ya.',
      colours: 'Colores',
      reward: '¿Qué se llevan?',
      rewardPlaceholder: 'Un café gratis',
      goal: '¿Cuántos sellos para conseguirlo?',
      goalHint:
        'Un cliente habitual que viene cada semana llega a {goal} en unas {goal} semanas. Menos de seis semanas mantiene el interés.',
      goalPoints: '¿Cuántos puntos para conseguirlo?',
      goalPointsHint:
        'Más o menos un punto por unidad gastada, así que {goal} puntos es un cliente que se ha dejado esa cantidad contigo.',
      /*
       * Nombra el destino. Antes decía "en el editor de la tarjeta", que es
       * cierto e inútil: no había forma de encontrar el editor de la tarjeta.
       * Ahora se lee como una indicación.
       */
      moreLater:
        'Las plantillas, la tipografía, el reverso de la tarjeta y todo lo que muestra están en Tu tarjeta → Diseño de la tarjeta, en tu panel, cuando los quieras.',
      activate: 'Activar la tarjeta',
    },
    ready: {
      title: 'Tu programa de fidelización está en marcha',
      subtitle:
        'Tu tarjeta está lista, tu recompensa configurada y las campañas de abajo ya funcionan. Pon el código en el mostrador y empieza a dar de alta clientes.',
      qrTitle: 'Tu código de alta',
      qrBody:
        'Imprímelo y ponlo junto a la caja. El cliente lo escanea, pone su email y la tarjeta ya está en su móvil.',
      qrAlt: 'Código QR para que los clientes se unan',
      running: 'Ya funcionando por ti',
      bullets: {
        reward: 'Tu recompensa: {reward}',
        welcome: 'Un mensaje de bienvenida cuando alguien se une',
        birthday: 'Un regalo por su cumpleaños',
        winback: 'Una oferta de reactivación tras 30 días sin pasar',
        rewardReady: '«Tu recompensa está lista» en cuanto la consiguen',
      },
      nextTitle: 'Cuando tengas un momento',
      next: {
        location: 'Añade tu dirección para que la tarjeta indique dónde encontrarte',
        campaigns: 'Activa una campaña pensada para tu sector',
        design: 'Personaliza tu tarjeta Wallet',
      },
      openScanner: 'Empezar a dar de alta clientes',
      goToDashboard: 'Explorar mi panel',
      laterNote:
        'El resto —otros locales, cercanía, campañas— te espera en el panel como una checklist. Nada de eso bloquea el mostrador.',
    },
    presets: {
      cafe: 'Un café gratis',
      bakery: 'Un dulce gratis',
      restaurant: 'Un postre gratis',
      bar: 'Una consumición a nuestra cuenta',
      barber: 'Un corte gratis',
      beauty: 'Un tratamiento gratis',
      gym: 'Una clase gratis',
      retail: 'Una recompensa de regalo',
      pet: 'Un premio gratis para él',
      other: 'Una recompensa de regalo',
    },
  },

  landing: {
    hero: {
      badge: 'Ya disponible: tarjetas que aparecen al pasar cerca',
      titleLead: 'Fidelización que vive',
      titleAccent: 'en la pantalla de bloqueo',
      subtitle:
        'Tarjetas de fidelización digitales en Apple Wallet y Google Wallet. El cliente escanea un QR y ya está dentro: sin descargar ninguna app. Y cuando pasa por tu puerta, su tarjeta vuelve a aparecer.',
      ctaPrimary: 'Empezar prueba de 14 días',
      ctaSecondary: 'Probar la demo',
      noCard: 'Sin tarjeta de crédito · Listo en diez minutos · Desde {price}/mes',
      founderPricing: 'Precios de lanzamiento para los primeros negocios',
    },
    trust: {
      title: 'Hecho para negocios locales de hoy',
      subtitle:
        'Diseñado para cafeterías, restaurantes, tiendas, peluquerías y gimnasios. Estamos abriendo el acceso anticipado: sé de los primeros en lanzar.',
      earlyAccess: 'Únete al acceso anticipado',
      earlyAccessBody:
        'Estamos incorporando a nuestros primeros negocios. Quien entre ahora mantiene el precio de lanzamiento de por vida, habla directamente con el equipo y decide qué construimos después.',
      launching: 'Lanzamiento inminente',
      builtFor: 'Pensado para',
      launchInOneSession: 'Lánzalo en una sola sesión',
      launchInOneSessionBody: 'Configura tu tarjeta, tu QR y tu primera recompensa en minutos.',
      noAppRequired: 'Sin app necesaria',
      noAppRequiredBody: 'Tus clientes pueden usar Apple Wallet o Google Wallet sin descargar nada.',
      builtForDailyUse: 'Hecho para el uso diario',
      builtForDailyUseBody: 'El escáner, la tarjeta y las campañas funcionan desde un mismo sistema.',
      segments: {
        cafe: 'Cafeterías',
        restaurant: 'Restaurantes y bares',
        retail: 'Tiendas',
        salon: 'Peluquerías y barberías',
        gym: 'Gimnasios y estudios',
        bakery: 'Panaderías',
      },
    },
    /**
     * La demo interactiva.
     *
     * Aquí no se habla de cámaras a propósito: la demo enseña el circuito de
     * fidelización —un habitual vuelve, el saldo se mueve, la recompensa se
     * desbloquea, la tarjeta se actualiza— y nunca le pide a quien entra desde
     * un ordenador que piense en un escáner que no puede usar. La única mención
     * es `scannerNote`, que dice claramente dónde está el escáner de verdad.
     */
    demo: {
      title: 'Todo el producto, en tu navegador',
      subtitle:
        'Esto no es un vídeo. Registra una visita, mira cómo se mueve el saldo, desbloquea una recompensa y ve cómo se actualiza la tarjeta que tu cliente lleva en el bolsillo, sin cámara, sin cuenta y sin descargar nada.',
      tabCounter: 'En el mostrador',
      tabWallet: 'Su tarjeta',
      tabNearby: 'Cuando pasa cerca',
      tabMerchant: 'Tu panel',
      counterBody:
        'Entra un habitual. Esto es lo que ve tu equipo, y la única acción que hace.',
      walletBody:
        'La misma tarjeta, en las dos wallets. Cambia el sector o el color y mira cómo la sigue.',
      merchantBody: 'Cada visita aparece aquí en cuanto ocurre.',
      programName: 'Recompensas de {business}',
      sampleLocation: 'Calle Mayor 12',
      memberSince: 'marzo',
      memberSinceLine: 'Cliente desde {since}',
      simulateVisit: 'Registrar una visita',
      recording: 'Registrando…',
      points: 'Puntos',
      nextReward: 'Próxima recompensa',
      readyNow: 'Lista ya',
      pointsAway: 'A {count} puntos',
      redeem: 'Canjear recompensa',
      reset: 'Empezar de nuevo',
      rewardUnlocked: 'Recompensa desbloqueada',
      rewardUnlockedBody: '{name} ha conseguido {reward}. La tiene esperando en su tarjeta.',
      stampsToGo_one: 'Falta {count} sello',
      stampsToGo_other: 'Faltan {count} sellos',
      flow: {
        visit: 'Atiendes a {name}',
        credited: 'Se le abonan un sello y {points} puntos',
        reward: 'Se desbloquea su recompensa',
        wallet: 'La tarjeta de su bolsillo se actualiza',
      },
      scannerNote:
        'En el producto real esto empieza con un escaneo: la cámara está en tu panel y en tu móvil, no en esta página.',
      sampleDataNote:
        'Datos de ejemplo, interfaz real. Ninguna cifra de esta página describe uso real.',
      previewDisclaimer:
        'Una vista previa del diseño. El pase lo emiten Apple y Google.',
      /*
       * La llamada a la acción de la propia demo. Nombra el paso siguiente, no
       * el producto: quien acaba de ver la tarjeta seguir su color quiere hacer
       * una.
       */
      ctaPrimary: 'Crea tu programa de fidelización',
      ctaNote: 'No hace falta cuenta para probar la demo de arriba.',
      customiseTrade: 'Prueba otro sector',
      customiseColour: 'Prueba otro color',
      tierLabel: 'Nivel',
      tiers: { bronze: 'Bronce', silver: 'Plata', gold: 'Oro' },
      lockScreen: 'Pantalla de bloqueo',
      distanceLabel: 'Está a {distance}',
      outsideRadius: 'No aparece nada hasta que está a menos de {distance}.',
      nearbyReady: 'Te espera {reward}.',
      nearbyPassing: 'Estás cerca de {business}: tu tarjeta está lista.',
      merchantToday: 'Hoy',
      merchantVisits: 'Visitas',
      merchantNewMembers: 'Nuevos miembros',
      merchantRewards: 'Recompensas entregadas',
      merchantRevenue: 'Ingresos atribuidos',
      campaignTitle: 'Campaña por proximidad',
      campaignBody: 'Café de la mañana · a menos de 150 m · de lunes a viernes, 07:00–10:30',
      liveNote: 'Datos de ejemplo, interfaz real.',
    },
    /**
     * La sección de la wallet: la más importante de la página, porque la tarjeta
     * es el producto.
     */
    wallet: {
      title: 'Una tarjeta que vive donde tu cliente ya mira',
      subtitle:
        'Apple Wallet y Google Wallet colocan un pase de forma distinta. Aquí tienes el tuyo en las dos, y lo que le pasa cuando cambias tu marca.',
      pickTrade: 'Elige un sector',
      pickColour: 'Elige un color',
      previewNote:
        'Son vistas previas del diseño, dibujadas por nosotros. El pase en sí lo generan y lo firman Apple y Google.',
      noApp: 'Sin app que instalar',
      noAppBody: 'El cliente añade la tarjeta a la wallet que ya tiene en el móvil.',
      live: 'Siempre al día',
      liveBody: 'El saldo, el nivel y las recompensas se envían a la tarjeta según cambian.',
      notify: 'Vuelve a la pantalla de bloqueo',
      notifyBody: 'Una tarjeta que reaparece cuando el cliente está cerca de tu puerta.',
      yours: 'Tuya, no nuestra',
      yoursBody: 'Once plantillas, tus colores, tu logo y tus palabras en el reverso.',
    },
    features: {
      title: 'Todo lo que necesita un negocio local, y nada más',
      subtitle: 'Un solo sistema para la tarjeta, el mostrador, las campañas y los números.',
      wallet: {
        title: 'Apple y Google Wallet',
        body: 'La tarjeta vive en la wallet que ya tienen. Nada que descargar, nada que perder.',
      },
      proximity: {
        title: 'Vuelve cuando pasan cerca',
        body: 'Define un radio por local y la tarjeta aparece en su pantalla de bloqueo al pasar. Al entrar, al salir o al quedarse.',
      },
      scanner: {
        title: 'Escáner incluido',
        body: 'Cualquier móvil, tablet u ordenador con cámara. Sin comprar hardware ni alquilar terminales.',
      },
      campaigns: {
        title: 'Campañas que se ejecutan solas',
        body: 'Happy hour, cumpleaños, recuperar clientes. Defines la regla una vez y trabaja cada semana por ti.',
      },
      analytics: {
        title: 'Números con los que decidir',
        body: 'Qué campaña trajo gente, cuánto tardaron en venir y cuánto valió.',
      },
      multiLocation: {
        title: 'Todos tus locales, una cuenta',
        body: 'Radios, horarios e informes por local. Añades uno y todas las tarjetas se actualizan.',
      },
    },
    howItWorks: {
      title: 'Tres pasos, diez minutos',
      subtitle: 'Desde crear la cuenta hasta que un cliente tiene tu tarjeta.',
      step1: {
        title: 'El cliente escanea tu QR',
        body: 'En el mostrador, en el ticket, en el escaparate. Sin tiendas de apps ni formularios.',
      },
      step2: {
        title: 'La tarjeta entra en su wallet',
        body: 'Apple Wallet o Google Wallet, con tu logo y tus colores.',
      },
      step3: {
        title: 'Tú escaneas, él suma',
        body: 'Apunta cualquier cámara a su tarjeta. Puntos, nivel y recompensas se actualizan al instante.',
      },
    },
    compare: {
      title: 'Por qué no las alternativas',
      subtitle: 'La versión honesta.',
      us: 'Passimo',
      paper: 'Tarjetas de cartón',
      genericApp: 'Apps de fidelización genéricas',
      enterprise: 'Plataformas enterprise',
      rows: {
        cost: 'Coste mensual',
        costUs: 'Desde {price}',
        costPaper: 'Imprimir, para siempre',
        costApp: 'Desde {price}',
        costEnterprise: 'Miles, más implantación',
        install: 'El cliente tiene que instalar una app',
        knowsCustomers: 'Sabes quiénes son tus clientes',
        proximity: 'Vuelve cuando pasan por delante',
        hardware: 'Necesita hardware especial',
        lost: 'La tarjeta se pierde',
        setup: 'Tiempo hasta estar en marcha',
        setupUs: 'Diez minutos',
        setupPaper: 'Una visita a la imprenta',
        setupApp: 'Días',
        setupEnterprise: 'Semanas, con jefe de proyecto',
      },
    },
    dashboardShowcase: {
      title: 'Lo que vas a usar de verdad',
      subtitle: 'El lado del negocio, pensado para quien está detrás de un mostrador.',
      customers: { title: 'Clientes', body: 'Cada visita, cada recompensa, cada nota, en una sola ficha.' },
      campaigns: { title: 'Campañas', body: 'Lo escribes una vez, eliges a quién y cuándo, y lo dejas funcionando.' },
      analytics: { title: 'Analíticas', body: 'Retención, cohortes y los ingresos que trajo cada campaña.' },
      scanner: { title: 'Escáner de mostrador', body: 'La cámara se abre al instante y no se cierra. Funciona sin conexión.' },
      wallet: { title: 'Wallet y geovallas', body: 'Radio, disparadores y textos, por local y sin programar.' },
      rewards: { title: 'Recompensas', body: 'Sellos, puntos, niveles y tarjetas regalo desde una pantalla.' },
    },
    pricing: {
      title: 'Precios sencillos que se pagan solos',
      subtitle:
        'Todos los planes incluyen las tarjetas wallet, el escáner y 14 días de prueba con todo desbloqueado.',
      monthly: 'Mensual',
      yearly: 'Anual',
      yearlyNote: 'Dos meses gratis',
      popular: 'Más popular',
      cta: 'Empezar prueba gratis',
      ctaCurrent: 'Tu plan actual',
      perMonth: '/mes',
      billedYearly: 'facturado al año',
      trialNote: 'Catorce días, todo desbloqueado, sin tarjeta. Cancelas con un clic.',
      includesEverything: 'Todo lo de {plan}, y además:',
      customersLabel: 'Clientes',
      locationsLabel: 'Locales',
      limitCustomers_one: '{count} cliente',
      limitCustomers_other: '{count} clientes',
      limitCustomersUnlimited: 'Clientes ilimitados',
      limitLocations_one: '{count} local',
      limitLocations_other: '{count} locales',
      limitLocationsUnlimited: 'Locales ilimitados',
    },
    cta: {
      title: 'Tus clientes ya llevan una wallet. Que estés dentro.',
      subtitle:
        'Configura tu tarjeta, imprime un QR y empieza a reconocer a quien vuelve una y otra vez.',
      button: 'Empezar prueba de 14 días',
      note: 'Sin tarjeta de crédito. Diez minutos hasta tu primer sello.',
    },
    footer: {
      product: 'Producto',
      company: 'Empresa',
      legal: 'Legal',
      features: 'Características',
      pricing: 'Precios',
      demo: 'Demo en vivo',
      docs: 'Documentación',
      about: 'Quiénes somos',
      contact: 'Contacto',
      earlyAccess: 'Acceso anticipado',
      privacy: 'Privacidad',
      terms: 'Términos',
      cookies: 'Cookies',
      rights: 'Todos los derechos reservados.',
      builtIn: 'Hecho para negocios locales.',
    },
  },

  auth: {
    login: {
      title: 'Bienvenido de nuevo',
      subtitle: 'Entra en tu panel.',
      email: 'Email',
      password: 'Contraseña',
      submit: 'Entrar',
      submitting: 'Entrando…',
      noAccount: '¿Aún no tienes cuenta?',
      signUp: 'Empezar prueba gratis',
      forgot: '¿Has olvidado la contraseña?',
      failed: 'Ese email y esa contraseña no coinciden.',
      unreachable: 'No hemos podido conectar. Comprueba tu conexión e inténtalo otra vez.',
      resetNeedsEmail: 'Escribe primero tu email y luego pulsa «¿Has olvidado la contraseña?».',
      resetSent: 'Si existe una cuenta con {email}, el enlace ya está en camino.',
      emailPlaceholder: 'tu@negocio.com',
      tooMany: 'Demasiados intentos. Espera unos minutos y vuelve a probar.',
    },
    reset: {
      title: 'Elige una contraseña nueva',
      subtitle: 'Después entrarás directamente.',
      newPassword: 'Contraseña nueva',
      confirmPassword: 'Repítela',
      hint: 'Mínimo 10 caracteres. Una frase corta que recuerdes es mejor que una palabra complicada.',
      submit: 'Guardar y entrar',
      submitting: 'Guardando…',
      tooShort: 'Elige una contraseña más larga: mínimo 10 caracteres.',
      mismatch: 'Las dos contraseñas no coinciden.',
      failed: 'No hemos podido cambiar tu contraseña. Pide un enlace nuevo e inténtalo otra vez.',
      done: 'Contraseña cambiada',
      doneHelp: 'Hemos cerrado tu sesión en el resto de dispositivos. Te llevamos al panel…',
      noToken: 'Esta página necesita el enlace de tu email',
      noTokenHelp:
        'Abre el email «Restablece tu contraseña» que te hemos enviado y pulsa el botón que lleva dentro.',
      backToLogin: 'Volver a iniciar sesión',
    },
    verify: {
      working: 'Confirmando tu email…',
      done: 'Email confirmado',
      doneHelp: 'Ya tienes activas las campañas, los avisos de facturación y la recuperación de contraseña.',
      toDashboard: 'Ir a mi panel',
      failed: 'No hemos podido confirmar este enlace',
      failedHelp:
        'Los enlaces de confirmación caducan a los tres días y solo sirven una vez. Pide uno nuevo en Ajustes.',
      resend: 'Enviar un enlace nuevo',
    },
    /** Textos de los dos emails que Passimo envía en su propio nombre. */
    emails: {
      passwordReset: {
        subject: 'Restablece tu contraseña de Passimo',
        body:
          'Alguien ha pedido restablecer la contraseña de esta cuenta de Passimo. ' +
          'Usa el botón de abajo durante la próxima hora para elegir una nueva. ' +
          'Si no has sido tú, puedes ignorar este email: no ha cambiado nada.',
        cta: 'Elegir una contraseña nueva',
      },
      verify: {
        subject: 'Confirma tu email en Passimo',
        body:
          'Bienvenido a Passimo. Al confirmar tu email activas las campañas, los avisos de ' +
          'facturación y la recuperación de contraseña de tu cuenta. Tu panel ya funciona: ' +
          'esto solo desbloquea todo lo que necesita llegarte por email.',
        cta: 'Confirmar mi email',
      },
    },
    signup: {
      title: 'Empieza tu prueba gratis',
      subtitle: 'Catorce días, todo desbloqueado, sin tarjeta.',
      businessName: 'Nombre del negocio',
      email: 'Email',
      password: 'Contraseña',
      submit: 'Crear mi cuenta',
      submitting: 'Creando tu cuenta…',
      hasAccount: '¿Ya tienes cuenta?',
      login: 'Iniciar sesión',
      passwordWeak: 'Usa al menos 10 caracteres, con un número y una letra.',
      terms: 'Al continuar aceptas nuestros términos y la política de privacidad.',
      businessNamePlaceholder: 'Café Central',
      emailPlaceholder: 'tu@negocio.com',
      passwordPlaceholder: 'Al menos 10 caracteres',
      categoryLabel: '¿Qué tipo de negocio es?',
      needsBusinessName: '¿Cómo se llama tu negocio?',
      badEmail: 'Ese email no parece correcto.',
      passwordTooShort: 'Elige una contraseña más larga: al menos 10 caracteres.',
      passwordTooSimple: 'Esa contraseña es fácil de adivinar. Prueba a añadir alguna palabra más.',
      failed: 'No hemos podido crear tu cuenta. Inténtalo otra vez.',
      strength: { weak: 'Débil', fair: 'Aceptable', good: 'Buena', strong: 'Fuerte' },
      perks: {
        wallet: 'Tarjetas digitales para Apple y Google Wallet',
        automations: 'Campañas automáticas de cumpleaños y recuperación',
        fast: 'Listo en menos de 5 minutos',
      },
      categories: {
        cafe: 'Cafetería',
        bakery: 'Panadería',
        restaurant: 'Restaurante',
        bar: 'Bar',
        barber: 'Barbería',
        beauty: 'Belleza y spa',
        gym: 'Gimnasio',
        retail: 'Tienda y boutique',
        pet: 'Tienda de mascotas',
        other: 'Otra cosa',
      },
    },
  },

  dashboard: {
    nav: {
      today: 'Hoy',
      sell: 'Vender',
      card: 'Tu tarjeta',
      grow: 'Crecer',
      understand: 'Entender',
      configure: 'Configurar',
      overview: 'Resumen',
      pointOfSale: 'Punto de venta',
      customers: 'Clientes',
      rewards: 'Recompensas',
      giftCards: 'Tarjetas regalo',
      memberships: 'Suscripciones',
      campaigns: 'Campañas',
      automations: 'Automatizaciones',
      growth: 'Referidos y reseñas',
      network: 'Red de socios',
      analytics: 'Analíticas',
      insights: 'Ideas con IA',
      locations: 'Locales',
      // "Diseño de la tarjeta", no "Configuración del pase": el comerciante
      // busca la palabra *tarjeta*, no un término técnico.
      walletCard: 'Diseño de la tarjeta',
      wallet: 'Wallet y proximidad',
      settings: 'Ajustes',
      billing: 'Plan y facturación',
      admin: 'Consola de administración',
      signOut: 'Cerrar sesión',
      yourBusinesses: 'Tus negocios',
      scan: 'Escanear',
      lockedHint: 'Disponible en un plan superior',
    },
    lapsed: {
      title: 'Tu suscripción está inactiva',
      body:
        'No se ha borrado nada: cada cliente, tarjeta y campaña sigue aquí. Reactívala para volver a atender.',
      cta: 'Reactivar desde {price}/mes',
    },
    notifications: {
      title: 'Avisos',
      label: 'Avisos',
      labelUnread_one: 'Avisos, {count} sin leer',
      labelUnread_other: 'Avisos, {count} sin leer',
      markAllRead: 'Marcar todos como leídos',
      unread: 'Sin leer',
      empty: 'Ahora mismo no hay nada que requiera tu atención',
    },
    trial: {
      daysLeft_one: 'Queda {count} día de prueba',
      daysLeft_other: 'Quedan {count} días de prueba',
      body: 'Tienes todo desbloqueado. Elige un plan cuando quieras.',
      cta: 'Ver planes',
    },
  },

  locations: {
    title: 'Locales',
    subtitle: 'Tus tiendas, sus horarios y la geovalla alrededor de cada una.',
    empty: 'Aún no hay locales',
    emptyBody: 'Añade tu primera tienda para que las tarjetas aparezcan cuando el cliente esté cerca.',
    addLocation: 'Añadir un local',
    editLocation: 'Editar local',
    /**
     * Resultado fila a fila de una importación masiva de locales.
     *
     * Se escribe con el traductor del *negocio* en `lib/wallet/locations.ts` y
     * no con el de la petición: la importación corre en el servidor y el
     * comerciante lee los fallos fila por fila en la previsualización.
     */
    import: {
      nameRequired: 'Falta el nombre',
      rowFailed: 'No hemos podido importar esta fila',
    },
    importLocations: 'Importar desde CSV',
    primary: 'Principal',
    makePrimary: 'Marcar como principal',
    hidden: 'Oculto',
    visible: 'Visible',
    archived: 'Archivado',
    archive: 'Archivar local',
    archiveConfirm:
      'Al archivarlo, esta tienda deja de aparecer en las tarjetas y en la página de alta. Su historial se conserva. ¿Continuar?',
    fields: {
      name: 'Nombre del local',
      namePlaceholder: 'Gran Vía',
      description: 'Descripción',
      address: 'Dirección',
      addressLine2: 'Piso, puerta, planta',
      city: 'Ciudad',
      region: 'Provincia',
      postalCode: 'Código postal',
      country: 'País',
      phone: 'Teléfono',
      email: 'Email',
      coordinates: 'Coordenadas',
      latitude: 'Latitud',
      longitude: 'Longitud',
      timezone: 'Zona horaria',
      visibility: 'Mostrar en las tarjetas y en la página de alta',
      sortOrder: 'Orden de aparición',
      externalRef: 'Tu propia referencia',
    },
    geocode: {
      lookUp: 'Buscar coordenadas',
      lookingUp: 'Buscando…',
      found: 'Encontrado: {address}',
      notFound: 'No hemos encontrado esa dirección. Introduce las coordenadas abajo.',
      notConfigured:
        'La búsqueda automática no está configurada en esta instalación. Introduce las coordenadas abajo: todo funciona igual.',
      manualHint: 'Haz clic derecho en un punto de Google Maps y copia los dos números.',
    },
    hours: {
      title: 'Horario',
      subtitle:
        'Se usa para no enviar avisos de «ven ahora» cuando estás cerrado. Déjalo en blanco si prefieres que no lo tengamos en cuenta.',
      closed: 'Cerrado',
      open24: 'Abierto 24 horas',
      addRange: 'Añadir un segundo tramo',
      removeRange: 'Quitar',
      from: 'De',
      to: 'a',
      copyToAll: 'Aplicar a todos los días',
      days: {
        mon: 'Lunes',
        tue: 'Martes',
        wed: 'Miércoles',
        thu: 'Jueves',
        fri: 'Viernes',
        sat: 'Sábado',
        sun: 'Domingo',
      },
      daysShort: {
        mon: 'Lun',
        tue: 'Mar',
        wed: 'Mié',
        thu: 'Jue',
        fri: 'Vie',
        sat: 'Sáb',
        sun: 'Dom',
      },
    },
    geofence: {
      title: 'Geovalla',
      subtitle: 'Cuándo y a qué distancia este local llega al móvil de un cliente.',
      enabled: 'Geovalla para este local',
      relevanceRadius: 'La tarjeta aparece a menos de',
      relevanceRadiusHelp:
        'A qué distancia tiene que estar el cliente para que la tarjeta salga en su pantalla de bloqueo.',
      notificationRadius: 'Avisar a menos de',
      notificationRadiusHelp:
        'A qué distancia puede dispararse el aviso de una campaña. Normalmente más amplio que el radio de la tarjeta.',
      secondaryRadius: 'Anillo exterior',
      secondaryRadiusHelp: 'Un radio más amplio, opcional, para mensajes de «te estás acercando».',
      triggers: 'Disparadores',
      onEntry: 'Cuando llega',
      onEntryHelp: 'Se dispara una vez, al entrar el cliente en el radio.',
      onExit: 'Cuando se va',
      onExitHelp: 'Útil para dar las gracias y pedir una reseña.',
      onDwell: 'Cuando se queda',
      onDwellHelp: 'Se dispara cuando lleva un rato dentro del radio.',
      dwellMinutes: 'Tras quedarse al menos',
      relevantText: 'Mensaje en la pantalla de bloqueo',
      relevantTextPlaceholder: 'Tu café gratis te espera en Gran Vía',
      relevantTextHelp:
        'Lo que Apple Wallet muestra en la pantalla de bloqueo para este local. En blanco, usamos un texto por defecto.',
      beacon: 'Beacon (opcional)',
      beaconHelp: 'Si tienes hardware iBeacon, introduce sus identificadores.',
      beaconUuid: 'UUID de proximidad',
      beaconMajor: 'Major',
      beaconMinor: 'Minor',
      noCoordinates: 'Añade coordenadas para activar la geovalla de este local.',
    },
  },

  wallet: {
    title: 'Wallet y proximidad',
    subtitle:
      'Cómo se comporta tu tarjeta en Apple Wallet y Google Wallet, y qué pasa cuando un cliente pasa cerca.',
    /**
     * La línea que muestra el pase en la pantalla de bloqueo cuando el cliente
     * está cerca del local, si el comerciante no ha escrito la suya.
     *
     * Se traduce con el idioma del *negocio*, nunca con el de quien mira: aquí
     * no hay nadie mirando nada. Es la frase que más convierte de todo el
     * producto y antes era un literal en inglés dentro de `pass-content.ts`.
     */
    relevance: {
      rewardWaiting: 'Te espera {reward} en {location}',
      yourReward: 'Tu recompensa',
      nearby: 'Estás cerca de {location}',
    },
    /**
     * La cara de la tarjeta: todas las etiquetas que Apple Wallet y Google
     * Wallet imprimen en el móvil del cliente.
     *
     * Se traduce con el idioma del *negocio*, por lo mismo que `relevance`: una
     * tarjeta se instala una vez y se lee durante meses, sin ninguna petición de
     * por medio. Antes eran literales en inglés dentro de `apple-pass.ts` y
     * `google-loyalty-jwt.ts`, así que los clientes de una cafetería española
     * llevaban una tarjeta con MEMBER / SINCE / TO GO y fechas en `en-GB`. Es la
     * superficie más permanente del producto y la única que el comerciante no
     * puede corregir desde el panel.
     *
     * El `%@` de `balanceChange` es el token de sustitución de Apple, no uno
     * nuestro: tiene que sobrevivir a la traducción.
     */
    pass: {
      tier: 'NIVEL',
      vip: 'VIP',
      balanceChange: 'Ahora tienes %@ {unit}',
      readyToClaim: 'LISTA PARA CANJEAR',
      nextReward: 'PRÓXIMA RECOMPENSA',
      rewardFallback: 'Recompensa',
      rewardReadyTitle: 'Recompensa lista',
      toGo: 'TE FALTAN',
      member: 'CLIENTE',
      since: 'DESDE',
      howItWorks: 'Cómo funciona',
      howItWorksGoal:
        'Reúne {goal} {unit} y consigue {reward}. Muestra esta tarjeta en el mostrador en cada visita.',
      howItWorksOpen:
        'Muestra esta tarjeta en el mostrador para acumular {unit} en cada visita.',
      yourReward: 'tu recompensa',
      offer: 'Oferta',
      offerUntil: 'Oferta — hasta el {date}',
      where: 'Dónde usarla',
      referral: 'Invita a alguien',
      referralBody: 'Comparte tu código {code}: os llevaréis premio los dos cuando se una.',
      referralBodyShort: 'Comparte tu código {code}: os llevaréis premio los dos.',
      pointsExpire: 'Los {unit} caducan',
      website: 'Web',
      contact: 'Contacto',
      manageCard: 'Gestiona tu tarjeta',
      viewCard: 'Ver tu tarjeta',
      goal: 'Objetivo',
      memberFallback: 'Cliente',
      logoAlt: 'Logo de {name}',
      programName: 'Recompensas de {business}',
      description: 'Tarjeta de fidelización de {business}',
      unitFallback: 'puntos',
    },
    /**
     * Texto de reserva para un aviso de proximidad, cuando la regla del
     * comerciante no trae título ni mensaje propios.
     *
     * `{{points}}` es un token de *plantilla de aviso* que expande después
     * `renderNotificationCopy` con los datos del cliente, no una interpolación
     * `{name}` nuestra. Sobrevive a la traducción porque el traductor solo
     * sustituye cuando se le pasan valores, y `nearbyBody` se resuelve sin
     * ninguno. No toques las llaves dobles.
     */
    push: {
      nearbyTitle: 'Estás cerca de {location}',
      nearbyBody: 'Tu tarjeta está lista: llevas {{points}} puntos.',
      cardReady: 'Tu tarjeta de fidelización está lista.',
      rewardTitle: 'Tu recompensa está lista',
      rewardBody: 'Te espera una recompensa en {location}.',
    },
    tabs: {
      brand: 'Marca',
      behaviour: 'Avisos',
      settings: 'Ajustes',
      campaigns: 'Campañas',
      rules: 'Reglas de automatización',
      analytics: 'Analíticas',
      templates: 'Plantillas',
    },
    providers: {
      title: 'Proveedores de wallet',
      configured: 'Listo',
      notConfigured: 'Sin configurar',
      missing: 'Falta: {vars}',
      notConfiguredBody:
        'No se pueden emitir tarjetas hasta que estas credenciales estén puestas en la instalación. Todo lo demás de esta pantalla se puede configurar ya y se aplicará en cuanto lo estén.',
      pushReady: 'Actualización de tarjetas activada',
      pushMissing: 'Actualización de tarjetas no disponible',
      supports: 'Admite',
      supportsGeofence: 'Relevancia por geovalla',
      supportsLockScreen: 'Sugerencias en pantalla de bloqueo',
      supportsBeacons: 'Beacons',
      supportsPush: 'Actualización en vivo',
      supportsRich: 'Texto de aviso personalizado',
    },
    masterSwitches: {
      title: 'Proximidad',
      proximityEnabled: 'Tarjetas con ubicación',
      proximityEnabledHelp:
        'Interruptor general. Desactivado, las tarjetas no llevan locales y no se envía ningún aviso por proximidad.',
      geofencingEnabled: 'Geovallas',
      geofencingEnabledHelp: 'Evaluar los disparadores de entrada, salida y permanencia de tus locales.',
      beaconsEnabled: 'Beacons',
      beaconsEnabledHelp: 'Incluir identificadores iBeacon en las tarjetas, si tienes el hardware.',
    },
    suggestions: {
      title: 'Sugerencias de wallet',
      subtitle: 'Qué puede hacer la app de wallet con tu tarjeta por su cuenta.',
      appleLockScreen: 'Sugerencias de Apple Wallet en pantalla de bloqueo',
      appleLockScreenHelp: 'iOS muestra la tarjeta cuando el cliente está cerca de uno de tus locales.',
      googleSuggestions: 'Sugerencias de Google Wallet',
      googleSuggestionsHelp: 'Google muestra la tarjeta cerca de tus locales.',
      nearbyRecommendations: 'Recomendaciones cercanas',
      nearbyRecommendationsHelp:
        'Mostrar locales cercanos y ofertas activas en la página de la tarjeta del cliente.',
      automaticUpdates: 'Actualización automática de la tarjeta',
      automaticUpdatesHelp: 'Enviar el nuevo saldo a las tarjetas instaladas en cuanto cambia.',
      dynamicContent: 'Contenido dinámico',
      dynamicContentHelp: 'Mostrar ofertas y recompensas al dorso de la tarjeta.',
      rewardNotifications: 'Avisos de recompensa',
      rewardNotificationsHelp: 'Avisar al cliente cuando tiene una recompensa lista.',
      loyaltyReminders: 'Recordatorios de fidelización',
      loyaltyRemindersHelp: 'Recordatorios suaves para clientes que llevan tiempo sin venir.',
      maxRelevantLocations: 'Locales por tarjeta',
      maxRelevantLocationsHelp:
        'Las dos wallets aceptan diez como máximo. Si tienes más, incluimos los más cercanos al cliente.',
    },
    frequency: {
      title: 'Con qué frecuencia, y cuándo',
      subtitle:
        'Una tarjeta wallet se borra la primera vez que parece spam, y no hay forma de volver a pedirla. Estos límites son deliberadamente conservadores.',
      defaultRadius: 'Radio por defecto',
      defaultRadiusHelp: 'Lo usa cada local que no defina el suyo.',
      defaultDwell: 'Permanencia por defecto',
      maxPerDay: 'Máximo de avisos por cliente y día',
      minHoursBetween: 'Intervalo mínimo entre avisos',
      respectQuietHours: 'Respetar el horario de silencio',
      quietFrom: 'Silencio de',
      quietUntil: 'a',
      quietHoursHelp: 'A estas horas no se envía ningún aviso, diga lo que diga la campaña.',
    },
    branding: {
      title: 'Texto de los avisos',
      subtitle: 'El texto por defecto de los avisos en la pantalla de bloqueo y de las campañas nuevas.',
      emoji: 'Emoji por defecto',
      notificationTitle: 'Título por defecto del aviso',
      notificationMessage: 'Mensaje por defecto del aviso',
      cta: 'Texto por defecto del botón',
      colorsMovedNote:
        'Los colores, el logo y la disposición de la tarjeta están en Diseño de la tarjeta, así hay un único sitio donde cambiar su aspecto.',
      brandColor: 'Fondo de la tarjeta',
      brandTextColor: 'Texto de la tarjeta',
      logoUrl: 'URL del logo',
      heroImageUrl: 'URL de la imagen de cabecera',
      passExpiration: 'La tarjeta caduca a los',
      passExpirationHelp: 'En blanco, la tarjeta no caduca nunca.',
      passExpirationDays: '{count} días',
    },
    preview: {
      title: 'Vista previa en vivo',
      subtitle: 'Exactamente lo que verán tus clientes.',
      apple: 'Apple Wallet',
      google: 'Google Wallet',
      lockScreen: 'Pantalla de bloqueo',
      notification: 'Aviso',
      balance: 'Puntos',
      tier: 'Nivel',
      reward: 'Próxima recompensa',
      member: 'Miembro',
      memberSince: 'Desde',
      showQr: 'Ver código',
      whereToUse: 'Dónde usarla',
    },
    campaigns: {
      title: 'Campañas por proximidad',
      subtitle: 'Qué decir, a quién, dónde y cuándo.',
      empty: 'Aún no hay campañas por proximidad',
      emptyBody: 'Empieza por una plantilla de tu tipo de negocio, o escribe una desde cero.',
      create: 'Nueva campaña',
      edit: 'Editar campaña',
      duplicate: 'Duplicar',
      activate: 'Activar',
      pause: 'Pausar',
      archive: 'Archivar',
      testIt: '¿Se enviaría?',
      sectionBasics: 'Lo básico',
      sectionTrigger: 'Cuándo se dispara',
      sectionSchedule: 'Calendario',
      sectionAudience: 'Quién la recibe',
      sectionMessage: 'Qué ven',
      sectionDelivery: 'Límites de envío',
      name: 'Nombre de la campaña',
      kind: 'Tipo',
      description: 'Nota interna',
      trigger: 'Disparador',
      triggers: {
        entry: 'Cuando llega',
        exit: 'Cuando se va',
        dwell: 'Cuando se queda un rato',
        nearby: 'Siempre que esté cerca',
        manual: 'Solo cuando yo la envíe',
      },
      radius: 'Radio',
      radiusHelp: 'En blanco, se usa el ajuste de cada local.',
      dwellMinutes: 'Tras quedarse',
      startsOn: 'Empieza',
      endsOn: 'Termina',
      weekdays: 'Días',
      startTime: 'De',
      endTime: 'a',
      timeHelp: 'Hora local de cada local.',
      allLocations: 'Todos los locales',
      pickLocations: 'Solo estos locales',
      segment: 'Segmento de clientes',
      segmentAny: 'Cualquiera',
      minTier: 'Nivel mínimo',
      minPoints: 'Puntos mínimos',
      minVisits: 'Visitas mínimas',
      minDaysSinceVisit: 'Sin venir desde al menos',
      maxDaysSinceVisit: 'Ha venido en los últimos',
      vipOnly: 'Solo clientes VIP',
      birthdayOnly: 'Solo el día de su cumpleaños',
      requiresReward: 'Solo si tiene una recompensa lista',
      requiresPass: 'Solo si tiene la tarjeta en su wallet',
      messageTitle: 'Título',
      messageBody: 'Mensaje',
      emoji: 'Emoji',
      ctaLabel: 'Texto del botón',
      ctaUrl: 'Enlace del botón',
      rewardDescription: 'Descripción de la recompensa',
      imageUrl: 'URL de la imagen',
      expiresAt: 'La oferta caduca',
      priority: 'Prioridad',
      priorityHelp: 'Cuando varias campañas encajan, gana la de mayor prioridad.',
      cooldownHours: 'Esperar antes de repetir',
      maxSends: 'Máximo de veces por cliente',
      tokens: 'Puedes usar: {tokens}',
      stats: {
        sent: 'Enviados',
        impressions: 'Vistos',
        clicks: 'Pulsados',
        visits: 'Visitas',
        redemptions: 'Canjeados',
        revenue: 'Ingresos',
        conversion: 'Conversión',
      },
      preflight: {
        wouldSend: 'Esto sí se enviaría',
        wouldNotSend: 'Esto no se enviaría ahora mismo',
        because: 'Porque:',
        testedAgainst: 'Probado con {name}',
        noCustomer: 'Añade un cliente para poder probarlo con una ficha real.',
      },
    },
    rules: {
      title: 'Reglas de automatización',
      subtitle: 'Si pasa esto, haz aquello. Sin programar.',
      empty: 'Aún no hay reglas',
      emptyBody: 'Añade una de las plantillas de abajo, o crea la tuya.',
      create: 'Nueva regla',
      edit: 'Editar regla',
      presets: 'Reglas listas para usar',
      addPreset: 'Añadir',
      added: 'Añadida',
      name: 'Nombre de la regla',
      description: 'Para qué sirve',
      whenAll: 'Cuando se cumpla todo esto',
      whenAny: 'Cuando se cumpla algo de esto',
      addCondition: 'Añadir una condición',
      addAction: 'Añadir una acción',
      then: 'Entonces',
      matchAll: 'Todo',
      matchAny: 'Algo',
      priority: 'Orden',
      priorityHelp: 'Los números más bajos se evalúan primero.',
      stopOnMatch: 'Parar cuando esta regla se cumpla',
      stopOnMatchHelp: 'Evita que una segunda regla envíe un segundo aviso por una sola visita.',
      cooldownHours: 'Esperar antes de repetir',
      summary: 'En palabras',
      matched_one: 'Se ha cumplido {count} vez',
      matched_other: 'Se ha cumplido {count} veces',
      neverMatched: 'Todavía no se ha cumplido',
      lastMatched: 'Última vez: {when}',
    },
    analytics: {
      title: 'Rendimiento por proximidad',
      subtitle: 'Si trae gente, y cuánto vale.',
      range30: 'Últimos 30 días',
      range7: 'Últimos 7 días',
      range90: 'Últimos 90 días',
      funnel: 'El embudo',
      suggestions: 'Sugerencias de tarjeta',
      notificationsSent: 'Avisos enviados',
      impressions: 'Vistos',
      clicks: 'Pulsados',
      walletOpens: 'Tarjeta abierta',
      storeVisits: 'Visitas al local',
      redemptions: 'Recompensas canjeadas',
      passesInstalled: 'Tarjetas instaladas',
      passesRemoved: 'Tarjetas eliminadas',
      geofenceEntries: 'Cruces de geovalla',
      revenue: 'Ingresos atribuidos',
      uniqueCustomers: 'Clientes alcanzados',
      clickThrough: 'Tasa de pulsación',
      conversion: 'Tasa de visita',
      redemptionRate: 'Tasa de canje',
      revenuePerSend: 'Ingresos por aviso',
      avgVisitDelay: 'Tiempo medio hasta la visita',
      avgVisitDelayHelp:
        'Cuánto tardó el cliente en entrar después del aviso. Solo contamos las visitas que podemos atribuir.',
      byCampaign: 'Por campaña',
      byLocation: 'Por local',
      recentNotifications: 'Avisos recientes',
      notSent: 'No enviado',
      skipReasons: {
        no_pass_installed: 'No tiene la tarjeta en la wallet',
        wallet_not_configured: 'Wallet sin configurar',
        quiet_hours: 'Horario de silencio',
        daily_cap: 'Límite diario alcanzado',
        too_soon: 'Enviado hace demasiado poco',
      },
      empty: 'Aún no hay actividad por proximidad',
      emptyBody:
        'En cuanto una campaña esté activa y un cliente pase por uno de tus locales, esto se llena.',
      noRevenue: 'Sin medir',
    },
    templates: {
      title: 'Estrategias de wallet',
      subtitle:
        'Una configuración completa para tu tipo de negocio: radios, horarios, campañas y reglas. Todo llega en pausa para que lo leas antes.',
      apply: 'Usar esta estrategia',
      applying: 'Configurando…',
      applied: 'Aplicada',
      includes: 'Configura',
      includesCampaigns_one: '{count} campaña',
      includesCampaigns_other: '{count} campañas',
      includesRules_one: '{count} regla',
      includesRules_other: '{count} reglas',
      appliedNote:
        'Creadas y desactivadas. Revisa los textos que llegarán a tus clientes y activa lo que quieras.',
      currentTemplate: 'Ahora usas la estrategia {name}',
    },
  },

  join: {
    title: 'Únete a {business}',
    subtitle: 'Junta {goal} {unit} y consigue {reward}. Sin instalar nada.',
    rewardFallback: 'un premio',
    unitFallback: 'sellos',
    cardRewardFallback: 'Un premio de nuestra parte',
    email: 'Email',
    emailPlaceholder: 'tu@email.com',
    firstName: 'Nombre (opcional)',
    birthday: 'Cumpleaños (opcional)',
    birthdayHint: 'Dinos tu cumpleaños y te mandamos un regalo.',
    consentTerms: 'Acepto unirme a este programa de fidelización y que {business} guarde mis datos para gestionarlo.',
    consentMarketing: 'Quiero recibir ofertas y premios. Puedes darte de baja cuando quieras.',
    submit: 'Quiero mi tarjeta',
    submitting: 'Preparando tu tarjeta…',
    needsTerms: 'Acepta las condiciones para unirte.',
    failed: 'No hemos podido darte de alta. Inténtalo otra vez.',
    notFound: 'Este programa de fidelización no existe.',
    notFoundBody:
      'Puede que el negocio haya cerrado su programa de fidelización o que la dirección esté mal escrita. Pide un QR nuevo en el mostrador.',
    notFoundAction: 'Ir a Passimo',
    loadFailed: 'No hemos podido cargar esta página. Inténtalo otra vez.',
    done: '¡Ya estás dentro!',
    doneBody: 'Añade la tarjeta a tu móvil para no perderla nunca.',
    openInBrowser: 'O abre tu tarjeta en el navegador',
    inviteTitle: 'Invita a alguien',
    inviteBody: 'Comparte tu código y los dos ganáis premio cuando se una y venga.',
    share: 'Compartir',
    emailedTo: 'También te hemos enviado la tarjeta a {email}.',
  },

  /**
   * La tienda pública de tarjetas regalo.
   *
   * La primera pantalla —y puede que la única— de un desconocido, y la única
   * página del producto donde hay dinero de por medio con alguien que no tiene
   * cuenta. La pasada anterior de localización se la saltó porque no tenía
   * ninguna clave: justo el punto ciego que cierra la prueba de cobertura de
   * pantallas de `tests/unit/i18n.test.ts`, y por eso `giftShop` ya está en esa
   * lista.
   *
   * Los importes se formatean con la moneda del negocio y no con un `€` fijo,
   * que es lo que imprimía la página sin importar en qué cobre el comercio.
   */
  giftShop: {
    header: 'Tarjeta regalo',
    headerCity: 'Tarjeta regalo · {city}',
    notOnSale: 'Aquí no se venden tarjetas regalo',
    notOnSaleBody: '{business} no vende tarjetas regalo online por ahora.',
    thankYou: 'Gracias',
    thankYouBody:
      'Tu tarjeta regalo de {business} está confirmada. Se la hemos enviado por correo a quien la recibe, y a ti te hemos mandado una copia del código por si prefieres entregarlo tú mismo.',
    howMuch: '¿De cuánto?',
    orAnyAmount: 'O cualquier importe entre {min} y {max}',
    whoFor: '¿Para quién es?',
    theirName: 'Su nombre',
    theirNamePlaceholder: 'María',
    theirEmail: 'Su correo',
    theirEmailPlaceholder: 'maria@ejemplo.com',
    messageOptional: 'Un mensaje (opcional)',
    messagePlaceholder: '¡Feliz cumpleaños! El café lo pongo yo.',
    sendOn: 'Enviarla el (opcional)',
    sendOnHint: 'Déjalo vacío para enviarla ya. Si no, llega esa mañana.',
    whoFrom: '¿Y de parte de quién?',
    yourName: 'Tu nombre',
    yourEmail: 'Tu correo',
    receiptNote: 'Para tu recibo. Nada más.',
    design: 'Diseño',
    designs: {
      classic: 'Clásico',
      birthday: 'Cumpleaños',
      thankYou: 'Gracias',
      celebration: 'Celebración',
      festive: 'Navideño',
    },
    pay: 'Pagar {amount}',
    stripeNote: 'El pago lo gestiona Stripe. Nunca vemos los datos de tu tarjeta.',
    paymentFailed: 'No hemos podido iniciar el pago. Vuelve a intentarlo.',
    failed: 'Algo ha ido mal',
  },

  cardDesign: {
    title: 'Diseño de la tarjeta',
    subtitle: 'El aspecto de tu tarjeta en el móvil de tus clientes.',

    /*
     * El título de `/dashboard/wallet/design`.
     *
     * Nombra las dos marcas a propósito: "diseño de la tarjeta" es lo que el
     * comerciante busca, y "Apple Wallet y Google Wallet" es lo que le confirma
     * que está en el sitio correcto.
     */
    pageTitle: 'Tu tarjeta Wallet',
    pageSubtitle:
      'Diseña la tarjeta de fidelización digital que tus clientes guardarán en Apple Wallet y Google Wallet. Cada cambio se ve al momento en la vista previa.',
    noAccess: 'No tienes acceso a la tarjeta',
    noAccessBody:
      'Tu rol no puede ver ni cambiar la tarjeta Wallet. Un propietario o gerente puede abrirla por ti, o cambiar tu rol en Ajustes.',

    related: {
      title: 'Relacionado',
      brandKit: 'Identidad de marca',
      brandKitBody:
        'Tu logo, tus colores y tus datos de contacto. La tarjeta parte de aquí: cámbialo una vez y todo lo demás sigue.',
      proximity: 'Wallet y proximidad',
      proximityBody:
        'Cuándo avisa la tarjeta a tus clientes, con qué frecuencia y qué dice el aviso en la pantalla de bloqueo.',
    },

    designHint: 'Colores, logo y disposición. Los cambios se ven al momento.',

    /**
     * La imagen de banner.
     *
     * Apple la imprime como `strip.png` y Google como `heroImage`. Los dos
     * proveedores leían `hero_image_url` desde la migración 21 mientras nada
     * podía asignarla y nada la mostraba: una columna a la que el comerciante
     * solo llegaba editando la base de datos. Ya tiene control de subida y sale
     * en las dos previsualizaciones.
     */
    hero: 'Imagen de banner',
    heroUpload: 'Subir un banner',
    heroReplace: 'Cambiar el banner',
    heroHint:
      'Un PNG, JPG o WebP panorámico, de hasta {max} KB. Va debajo de tu nombre en la tarjeta: una foto del local o de un producto funciona bien.',

    templates: {
      title: 'Empieza con una plantilla',
      subtitle: 'Elige una y cambia lo que quieras.',
      applied: 'Plantilla aplicada',
      basedOn: 'A partir de {name}',
      minimal: { name: 'Mínima', description: 'Limpia y sobria. Tu logo manda.' },
      premium: { name: 'Premium', description: 'Degradado cálido y letra con gracia.' },
      modern: { name: 'Moderna', description: 'Dos tonos con carácter y letra redondeada.' },
      coffee: { name: 'Cafetería', description: 'Sellos bien visibles en tonos café.' },
      restaurant: { name: 'Restaurante', description: 'Puntos y niveles para quien gasta más.' },
      bakery: { name: 'Panadería', description: 'Tonos suaves de horno y tarjeta de sellos.' },
      barber: { name: 'Barbería', description: 'Azul y nítida, contando visitas.' },
      beauty: { name: 'Centro de belleza', description: 'Puntos y niveles en tonos rosados.' },
      gym: { name: 'Gimnasio', description: 'Niveles de socio con mucho contraste.' },
      retail: { name: 'Tienda', description: 'Por puntos, pensada para compras repetidas.' },
      luxury: { name: 'Lujo', description: 'Solo el nivel. Sin barras ni aire de descuento.' },
    },

    style: {
      title: 'Estilo de la tarjeta',
      solid: 'Liso',
      gradient: 'Degradado',
      duotone: 'Dos tonos',
      frosted: 'Esmerilado',
    },

    progress: {
      title: 'Mostrar el progreso como',
      auto: 'Automático',
      autoHint: 'Sellos si va por sellos, barra si va por puntos.',
      bar: 'Barra de progreso',
      stamps: 'Sellos',
      points: 'Solo el número',
      none: 'No mostrar el progreso',
      tooManyStamps: 'Un objetivo de {count} son demasiados sellos para dibujarlos, así que se usa una barra.',
    },

    typography: {
      title: 'Tipografía',
      system: 'Estándar',
      rounded: 'Redondeada',
      serif: 'Con gracia',
      mono: 'Monoespaciada',
    },

    colors: {
      title: 'Colores',
      background: 'Fondo de la tarjeta',
      foreground: 'Texto',
      accent: 'Color de acento',
      inherit: 'Usando los colores de tu marca',
      reset: 'Volver a los de la marca',
      autoText: 'Elegido automáticamente para que se lea bien',
      contrastWarning: 'Ese color de texto se lee mal sobre ese fondo, así que usamos uno legible.',
    },

    show: {
      title: 'Qué aparece en la tarjeta',
      memberName: 'Nombre del cliente',
      memberSince: 'Cliente desde',
      tier: 'Nivel',
      location: 'Local',
      reward: 'Próximo premio',
      progress: 'Progreso',
    },

    copy: {
      title: 'Tus textos',
      headline: 'Título de la tarjeta',
      headlinePlaceholder: 'Por defecto, el nombre de tu negocio',
      customMessage: 'Mensaje del reverso',
      customMessagePlaceholder: 'Gracias por venir tanto por aquí.',
      terms: 'Letra pequeña',
      termsPlaceholder: 'Un premio por visita. No canjeable por dinero.',
    },

    back: {
      title: 'Reverso de la tarjeta',
      empty: 'Escribe un mensaje o la letra pequeña y aparecerán aquí.',
      show: 'Ver el reverso',
      showFront: 'Ver el anverso',
    },

    logo: {
      title: 'Tu logo',
      sharedHint:
        'Es el logo de tu marca. Si lo cambias aquí, cambia en todas partes: tu tarjeta, tu página de alta y tus correos.',
    },

    preview: {
      title: 'Vista previa',
      disclaimer:
        'Una vista previa de tu diseño. La tarjeta real la generan Apple y Google cuando se configuren las credenciales.',
      notConfigured: 'Las tarjetas de wallet aún no están activas en esta instalación.',
      notConfiguredBody:
        'Tu diseño está guardado y se usará en cuanto se añadan las credenciales de {providers}. Mientras tanto, tus clientes reciben la tarjeta web, que usa este mismo diseño.',
      sampleCustomer: 'Cliente de ejemplo',
      /* Valores de relleno para un negocio que todavía no ha puesto nombre a su
         programa. Solo salen en la vista previa, nunca en una tarjeta real. */
      defaultProgram: 'Tarjeta de fidelidad',
      defaultUnitSingular: 'punto',
      defaultUnitPlural: 'puntos',
    },

    save: 'Guardar diseño',
    saved: 'Diseño guardado',
    saveFailed: 'No hemos podido guardar el diseño. Inténtalo otra vez.',
    unsaved: 'Cambios sin guardar',
  },

  /**
   * "Tu tarjeta Wallet" — el acceso al editor.
   *
   * Dos versiones de cada línea, porque los dos comerciantes que lo leen están
   * en situaciones distintas: uno no ha abierto nunca el editor y necesita que
   * le digan que la tarjeta es suya para cambiarla; el otro lo hizo el mes
   * pasado y solo necesita volver a entrar rápido.
   */
  walletCard: {
    calloutTitle: 'Tu tarjeta Wallet',
    calloutBody: 'Esto es lo que llevan tus clientes. Cambia lo que quieras.',
    calloutFreshBody:
      'Tu tarjeta está lista para personalizar: tus colores, tu logo y lo que muestra.',
    calloutFreshBadge: 'Aún sin personalizar',
    calloutCta: 'Personalizar tarjeta',
    calloutFreshCta: 'Diseña tu tarjeta',
    calloutTemplates: 'Ver plantillas',
  },

  brandKit: {
    title: 'Marca',
    subtitle: 'Tu logo, tus colores y tus datos. Se usan en tarjetas, páginas y correos.',
    identity: 'Identidad',
    name: 'Nombre del negocio',
    description: 'Descripción breve',
    descriptionPlaceholder: 'Café de especialidad y bollería, desde 2019.',
    logo: 'Logo',
    logoHint: 'Un PNG, JPG o WebP cuadrado, de hasta {max} KB. Sale en tu tarjeta de fidelidad.',
    logoUpload: 'Subir un logo',
    logoReplace: 'Cambiar el logo',
    logoUploading: 'Subiendo…',
    logoUrlFallback: 'Pega un enlace a tu logo. En esta instalación no se pueden subir archivos.',
    logoErrors: {
      empty: 'Ese archivo está vacío.',
      /*
       * En KB, no en MB. El techo es lo que un pase de wallet llega a incrustar
       * de verdad (512 KB), y «0,5 MB» es una forma peor de decir lo mismo.
       */
      tooLarge: 'Ese archivo pesa demasiado. El límite son {max} KB.',
      unsupportedFormat: 'Usa una imagen PNG, JPG o WebP.',
      uploadFailed: 'No hemos podido subir esa imagen. Inténtalo otra vez.',
    },
    icon: 'Icono',
    cover: 'Imagen de portada',
    colors: 'Colores',
    colorsHint: 'Tu tarjeta, tu página de alta y tus correos usan estos colores.',
    primary: 'Principal',
    secondary: 'Secundario',
    secondaryOptional: 'Opcional',
    accent: 'Acento',
    textColor: 'Texto',
    useLegibleText: 'Usar un color legible',
    font: 'Tipografía',
    contact: 'Contacto',
    contactHint: 'Sale en el reverso de tu tarjeta y en tu página de alta.',
    email: 'Email',
    phone: 'Teléfono',
    website: 'Web',
    address: 'Dirección',
    city: 'Ciudad',
    postalCode: 'Código postal',
    social: 'Redes',
    instagram: 'Instagram',
    facebook: 'Facebook',
    tiktok: 'TikTok',
    handlePlaceholder: 'tunegocio',
    handleHint: 'Solo el usuario — el enlace lo montamos nosotros.',
    usedIn: 'Se usa en tu tarjeta, tu página de alta, tus correos y tus campañas.',
    saved: 'Marca guardada',
    saveFailed: 'No hemos podido guardar la marca. Inténtalo otra vez.',
  },

  card: {
    title: 'Tu tarjeta',
    balance: 'Tu saldo',
    addToApple: 'Añadir a Apple Wallet',
    addToGoogle: 'Guardar en Google Wallet',
    walletUnavailable: 'Las tarjetas wallet aún no están disponibles en esta instalación.',
    showAtCounter: 'Enseña esto en el mostrador',
    progress: 'Progreso',
    toGo_one: 'Falta {count}',
    toGo_other: 'Faltan {count}',
    rewardReady: 'Tu recompensa está lista',
    rewardReadyBody: 'Enseña esta tarjeta en el mostrador para canjearla.',
    nearby: 'Dónde usarla',
    nearbyOpen: 'Abierto ahora',
    nearbyClosed: 'Cerrado',
    nearbyDistance: 'a {distance}',
    offers: 'Ofertas para ti',
    waitingForYou: 'Te está esperando',
    showCodeAtCounter: 'Enseña este código en el mostrador',
    validUntil: 'Válido hasta el {date}',
    giftCardBalance: 'Saldo de tarjeta regalo',
    earnMultiplier: 'Ganas {multiplier}× en todo',
    renews: 'Se renueva el {date}',
    rewardsYouCanEarn: 'Recompensas que puedes conseguir',
    ready: 'Lista',
    keepItOnYourPhone: 'Llévala en el móvil',
    inviteAFriend: 'Invita a un amigo',
    inviteBody: 'Los dos ganáis cuando se apunta y viene.',
    shareInvite: 'Compartir mi invitación',
    linkCopied: 'Enlace copiado',
    memberSinceDate: 'Miembro desde el {date}',
    linkExpired: 'Este enlace ha caducado. Pide uno nuevo en la tienda.',
    couldNotLoad: 'No hemos podido cargar tu tarjeta.',
    moreToReach: 'Te falta {count} para llegar a {tier}',
    enableLocation: 'Enséñame el local más cercano',
    enableLocationBody:
      'Usamos tu ubicación una vez, en tu navegador, solo para ordenar la lista. No guardamos más que una posición aproximada.',
    locationDenied: 'Sin problema: aquí están todos tus locales.',
  },

  /**
   * Estrategias de wallet por sector: la galería y el texto que siembra cada
   * plantilla.
   *
   * Aquí conviven dos públicos, y la diferencia importa más de lo que parece.
   * `name`, `summary` y las `description` las lee el *comerciante* que elige una
   * estrategia. Cada `title`, `message` y `cta` se guarda en una campaña y acaba
   * en la *pantalla de bloqueo de un cliente*, y por eso se traducen con el
   * idioma del negocio en el momento de aplicar la plantilla, no con el de quien
   * pulsó el botón.
   */
  walletTemplates: {
    rules: {
      rewardReady: {
        name: 'Recompensa esperando cerca',
        description:
          'Cuando un cliente con una recompensa disponible se acerca, se lo recordamos.',
      },
      birthday: {
        name: 'Recompensa de cumpleaños',
        description: 'El día de su cumpleaños, se activa su detalle.',
        title: '¡Feliz cumpleaños!',
        message: 'Hoy te espera tu detalle de cumpleaños.',
        cta: 'Ver mi recompensa',
      },
      winBack: {
        name: 'Bienvenido de nuevo',
        description: 'Cuando pasa cerca alguien que hace tiempo que no viene, le invitamos a entrar.',
        title: 'Te echábamos de menos',
        message: 'Hace tiempo que no vienes. Pásate y sigue donde lo dejaste.',
        cta: 'Abrir mi tarjeta',
      },
      vip: {
        name: 'Llega un VIP',
        description: 'Avisa al equipo cuando entra un cliente VIP, para atenderle bien.',
        title: 'Acaba de entrar un cliente VIP',
      },
    },

    coffee_shop: {
      name: 'Cafetería',
      summary: 'Habituales de la mañana, radio corto, un aviso al día como mucho.',
      campaigns: {
        coffee_morning: {
          name: 'Café de la mañana',
          description: 'Aprovecha el trayecto al trabajo, de 07:00 a 10:30 entre semana.',
          title: 'Tu café de la mañana te espera',
          message: 'Estás a la vuelta de la esquina. El de siempre, y un sello más.',
          cta: 'Abrir mi tarjeta',
        },
        reward_ready: {
          name: 'Café gratis esperando',
          description: 'Solo para quien ya se ha ganado su café.',
          title: 'Tu café gratis te espera',
          message: 'Te lo has ganado. Enseña tu tarjeta en el mostrador.',
          cta: 'Canjear ahora',
          reward: 'Un café gratis a tu elección',
        },
        win_back: {
          name: 'Hace tiempo que no te vemos',
          description: 'Llega a los habituales que se han despistado, cuando pasan cerca.',
          title: 'Tu mesa sigue aquí',
          message: 'Han pasado un par de semanas. Vente y te invitamos a uno.',
          cta: 'Ver mi tarjeta',
        },
      },
    },

    bakery: {
      name: 'Panadería',
      summary: 'Al ritmo del horno, mañanas de fin de semana, radio corto.',
      campaigns: {
        coffee_morning: {
          name: 'Recién horneado',
          description: 'La hornada de la mañana, cada día hasta que se acaba.',
          title: 'Recién salido del horno',
          message: 'Todavía caliente. Estás a dos minutos.',
          cta: 'Abrir mi tarjeta',
        },
        weekend: {
          name: 'Capricho de fin de semana',
          description: 'Sábado y domingo, cuando se compra para toda la mesa.',
          title: 'Ya está el horneado del fin de semana',
          message: '¿Algo para la mesa? Sellos dobles todo el fin de semana.',
          cta: 'Ver la tarjeta',
        },
      },
    },

    restaurant: {
      name: 'Restaurante',
      summary: 'Franjas de comida y cena, radio más amplio, botón para reservar.',
      campaigns: {
        lunch: {
          name: 'Menú del día',
          description: 'Comida entre semana, para quien ya está por la zona.',
          title: 'El menú de hoy',
          message: 'Dos platos y café. Ahora mismo hay mesa libre.',
          cta: 'Ver el menú',
        },
        weekend: {
          name: 'Cena de fin de semana',
          description: 'Viernes y sábado por la noche.',
          title: '¿Cenamos esta noche?',
          message: 'Tenemos mesa a las 20:30. Y tus puntos vienen incluidos.',
          cta: 'Reservar mesa',
        },
        vip_event: {
          name: 'Cata VIP',
          description: 'Solo para habituales: tus clientes más valiosos.',
          title: 'Una invitación, solo para ti',
          message: 'Una noche de cata para nuestros habituales. Doce plazas.',
          cta: 'Reservar plaza',
        },
      },
    },

    barber_shop: {
      name: 'Barbería',
      summary: 'Al ritmo de las citas: avisa a las cuatro semanas, no en la puerta.',
      campaigns: {
        custom: {
          name: 'Toca recortar',
          description: 'Salta cuando han pasado cuatro semanas desde el último corte.',
          title: '¿Toca un repaso?',
          message: 'Han pasado unas cuatro semanas. Hoy tenemos silla libre.',
          cta: 'Reservar ahora',
        },
        reward_ready: {
          name: 'Corte gratis conseguido',
          description: 'Cada décimo corte, cuando pasan cerca.',
          title: 'Tu corte gratis te espera',
          message: 'Diez visitas, una invitamos nosotros. Vente cuando te venga bien.',
          cta: 'Canjearlo',
        },
      },
    },

    beauty_salon: {
      name: 'Centro de belleza',
      summary: 'Con cita previa, poca frecuencia, trato VIP a las habituales.',
      campaigns: {
        custom: {
          name: 'Recordatorio de cita',
          description: 'Seis semanas después de la última cita.',
          title: '¿Preparada para tu próxima cita?',
          message: 'Esta semana tenemos hueco, y tus puntos te están esperando.',
          cta: 'Reservar ahora',
        },
        vip_event: {
          name: 'Noche VIP',
          description: 'Una noche privada para tus mejores clientas.',
          title: 'Estás invitada',
          message: 'Una noche VIP con tratamientos y una copa de algo rico.',
          cta: 'Guardar mi plaza',
        },
      },
    },

    gym: {
      name: 'Gimnasio y fitness',
      summary: 'El problema es la ausencia, no la cercanía. Radio amplio y avisos de racha.',
      campaigns: {
        custom: {
          name: 'Estás cerca: entrena hoy',
          description: 'Avisa a los socios que están cerca pero llevan una semana sin venir.',
          title: 'Estás a dos minutos',
          message: 'Una sesión corta también cuenta. Mantén la racha.',
          cta: 'Registrar visita',
        },
        double_points: {
          name: 'Puntos dobles en horas valle',
          description: 'Llena las horas tranquilas de la tarde.',
          title: 'Puntos dobles esta tarde',
          message: 'Sala tranquila, el doble de puntos. Hasta las 16:00.',
          cta: 'Ver mi tarjeta',
        },
        win_back: {
          name: 'Vuelve con más fuerza',
          description: 'Socios que llevan un mes sin entrenar.',
          title: 'Tu cuota te está esperando',
          message: 'Con una sesión basta para volver a empezar. Te echamos una mano.',
          cta: 'Reservar una sesión',
        },
      },
    },

    retail_store: {
      name: 'Tienda',
      summary: 'A pie de calle: capta a quien ya está pasando por delante.',
      campaigns: {
        welcome: {
          name: 'Estás cerca',
          description: 'Un aviso suave para los socios que pasan por delante.',
          title: 'Estás justo en la puerta',
          message: 'Tienes puntos listos para gastar. Y hay novedades en tienda.',
          cta: 'Abrir mi tarjeta',
        },
        weekend: {
          name: 'Promoción de fin de semana',
          description: 'De viernes a domingo, cuando más gente pasa.',
          title: 'Oferta de fin de semana para socios',
          message: 'Los socios ahorran este fin de semana. Enseña tu tarjeta en caja.',
          cta: 'Ver la oferta',
        },
        seasonal: {
          name: 'Rebajas de temporada',
          description: 'Una campaña con fechas que activas para el periodo de rebajas.',
          title: 'Hoy empiezan las rebajas',
          message: 'Los socios eligen primero. Y tus puntos siguen valiendo.',
          cta: 'Ver las rebajas',
        },
      },
    },

    pet_shop: {
      name: 'Tienda de mascotas',
      summary: 'Ciclos de repetición previsibles: el pienso se acaba con calendario.',
      campaigns: {
        custom: {
          name: 'Toca reponer',
          description: 'Cuatro semanas desde la última visita: más o menos un saco de pienso.',
          title: '¿Te queda poco?',
          message: 'Estás cerca y ha pasado casi un mes. Tenemos el de siempre.',
          cta: 'Abrir mi tarjeta',
        },
        reward_ready: {
          name: 'Recompensa lista',
          description: 'Recompensa de fidelidad para clientes que repiten.',
          title: 'Un premio de nuestra parte',
          message: 'Tu recompensa de fidelidad está lista para recoger.',
          cta: 'Canjearla',
        },
      },
    },

    pharmacy: {
      name: 'Farmacia',
      summary: 'Deliberadamente discreta. Aquí importa más la confianza que la frecuencia.',
      campaigns: {
        reward_ready: {
          name: 'Recompensa disponible',
          description: 'El único mensaje por cercanía que debería enviar una farmacia.',
          title: 'Tienes una recompensa disponible',
          message: 'Tienes una recompensa que puedes recoger en tu próxima visita.',
          cta: 'Ver mi tarjeta',
        },
      },
    },

    supermarket: {
      name: 'Supermercado',
      summary: 'Al ritmo de la compra semanal, radio amplio, ofertas antes que recordatorios.',
      campaigns: {
        welcome: {
          name: 'Hoy, precios de socio',
          description: 'Capta la compra semanal según llega el cliente.',
          title: 'Hoy, precios de socio',
          message: 'Escanea tu tarjeta en caja y se aplican los precios de socio de hoy.',
          cta: 'Abrir mi tarjeta',
        },
        double_points: {
          name: 'Puntos dobles entre semana',
          description: 'Reparte la demanda fuera del pico del sábado.',
          title: 'Hoy, puntos dobles',
          message: 'Compra entre semana, el doble de puntos. Hasta el cierre.',
          cta: 'Ver mi tarjeta',
        },
      },
    },
  },

  admin: {
    title: 'Administración de la plataforma',
    subtitle: 'Todos los negocios de esta instalación.',
    tabs: {
      overview: 'Resumen',
      businesses: 'Negocios',
      plans: 'Planes',
      wallet: 'Wallet',
      audit: 'Registro de suplantaciones',
    },
    metrics: {
      businesses: 'Negocios',
      active: 'Pagando',
      trialing: 'En prueba',
      lapsed: 'Inactivos',
      customers: 'Clientes',
      scans: 'Escaneos (30 días)',
      passes: 'Tarjetas wallet',
      mrr: 'Ingresos recurrentes',
    },
    businesses: {
      search: 'Buscar negocios',
      plan: 'Plan',
      status: 'Estado',
      customers: 'Clientes',
      locations: 'Locales',
      created: 'Alta',
      owner: 'Propietario',
      actions: 'Acciones',
      view: 'Ver',
      impersonate: 'Ver como el negocio',
      changePlan: 'Cambiar plan',
      empty: 'Ningún negocio coincide.',
      onTrial: 'prueba',
      trialEnds: 'La prueba termina el {date}',
    },
    planChange: {
      title: 'Cambiar plan',
      body:
        'Esto se escribe en el registro de auditoría del propio negocio. Verán que soporte cambió su plan, y por qué.',
      plan: 'Nuevo plan',
      trialEndsAt: 'La prueba termina',
      reason: 'Motivo',
      reasonPlaceholder: 'Webhook de Stripe fallido: el cliente pagó Pro el 12 de junio',
      submit: 'Aplicar el cambio',
    },
    impersonate: {
      title: 'Ver como el negocio',
      body:
        'Queda registrado, es visible para el negocio y caduca en una hora. Es solo lectura: ves lo que ven, no actúas por ellos.',
      reason: '¿Por qué lo necesitas?',
      reasonPlaceholder: 'Ticket #482: el cliente no ve sus campañas',
      start: 'Iniciar sesión',
      stop: 'Terminar sesión',
      active: 'Viendo {name} como soporte · termina {when}',
    },
    capabilities: {
      title: 'Capacidades de la instalación',
      subtitle: 'Qué integraciones tienen credenciales aquí.',
      configured: 'Configurada',
      missing: 'Sin configurar',
    },
  },

  /**
   * Estados compartidos de carga, vacío y error.
   *
   * Los renderiza todas las listas del panel, así que traducirlos una vez es lo
   * que evita que una pantalla en español muestre «Loading…» mientras llegan sus
   * datos: el fallo de idiomas mezclados más difícil de ver en una revisión,
   * porque sólo existe mientras dura una petición.
   */
  states: {
    loading: 'Cargando',
    tooManyRequests: 'Demasiadas peticiones',
    unexpected: 'Ha ocurrido un error inesperado.',
  },

  metrics: {
    newThisPeriod: 'Nuevo en este periodo',
    vsPreviousPeriod: 'frente al periodo anterior',
    progress: 'Progreso',
  },

  overview: {
    members: 'Miembros',
    membersHint:
      'Todas las personas inscritas en tu programa. La tendencia compara las altas de este periodo con las del anterior.',
    repeatRate: 'Tasa de repetición',
    repeatRateHint:
      'Proporción de miembros que han venido más de una vez. Es el número que un programa de fidelización existe para mover.',
    revenue30: 'Ingresos (30 días)',
    revenue30Hint:
      'Gasto registrado de miembros identificados. Conecta tu TPV para capturar todas las transacciones automáticamente.',
    atRisk: 'En riesgo',
    atRiskHint:
      'Miembros sin visitas desde hace más de 60 días. Cada uno es un cliente que ya pagaste por captar.',
    activity: 'Actividad',
    last30Days: 'Últimos 30 días',
    tabVisits: 'Visitas',
    tabRevenue: 'Ingresos',
    noActivity: 'Todavía no hay actividad',
    noActivityBody: 'Registra tu primera visita en el mostrador y este gráfico cobra vida.',
    openPos: 'Abrir el punto de venta',
    doThisNext: 'Haz esto ahora',
    aiSpotted: 'La IA ha detectado',
    seeAllInsights: 'Ver todas las sugerencias',
    bestCustomers: 'Tus mejores clientes',
    noMembers: 'Todavía no hay miembros',
    noMembersBody: 'En cuanto la gente se una, aquí aparecerán tus habituales de más valor.',
    visitsCount_one: '{count} visita',
    visitsCount_other: '{count} visitas',
    programHealth: 'Salud del programa',
    health: {
      retention: 'Retención',
      retentionHint: 'Miembros activos en los últimos 30 días',
      churn: 'Fuga',
      churnHint: 'Miembros sin visitas desde hace más de 60 días',
      averageTicket: 'Ticket medio',
      averageTicketHint: 'Gasto medio por compra registrada',
      customerValue: 'Valor por cliente',
      customerValueHint: 'Gasto medio total por miembro',
      rewardsClaimed: 'Recompensas canjeadas',
      rewardsClaimedHint: 'En los últimos 30 días',
      outstanding: 'Saldo pendiente',
      outstandingHint: 'Puntos y sellos sin canjear: un pasivo en tus cuentas',
      nps: 'NPS',
      npsResponses_one: '{count} respuesta en los últimos 30 días',
      npsResponses_other: '{count} respuestas en los últimos 30 días',
      npsNone: 'Todavía no hay respuestas a encuestas',
    },
    actions: {
      lapsedTitle_one: '{count} miembro se ha quedado en silencio',
      lapsedTitle_other: '{count} miembros se han quedado en silencio',
      lapsedBody: 'Dales un motivo para volver antes de que olviden que existes.',
      lapsedCta: 'Recuperarlos',
      firstMemberTitle: 'Añade a tu primer miembro',
      firstMemberBody: 'Imprime tu QR o inscribe a alguien en el mostrador para arrancar.',
      firstMemberCta: 'Conseguir mi QR',
      repeatTitle: 'Sólo vuelve el {rate}',
      repeatBody:
        'Puede que tu recompensa quede demasiado lejos. Revisa el objetivo del programa.',
      repeatCta: 'Revisar las recompensas',
      feedbackTitle: 'Todavía no tienes opiniones',
      feedbackBody: 'Pregunta a tus miembros qué tal fue su última visita: les cuesta un toque.',
      feedbackCta: 'Activar las encuestas',
      healthyTitle: 'Todo tiene buena pinta',
      healthyBody: 'Buen momento para probar una campaña y subir las visitas repetidas.',
      healthyCta: 'Crear una campaña',
    },
  },

  customers: {
    title: 'Clientes',
    subtitleDefault: 'Los miembros de tu programa de fidelización',
    subtitleCount_one: '{count} miembro',
    subtitleCount_other: '{count} miembros',
    export: 'Exportar',
    import: 'Importar',
    addCustomer: 'Añadir cliente',
    searchPlaceholder: 'Busca por nombre, correo o teléfono',
    searchLabel: 'Buscar clientes',
    allCustomers: 'Todos los clientes',
    filterLabel: 'Segmento',
    sort: {
      recent: 'Se unieron hace poco',
      spend: 'Mayor gasto',
      visits: 'Más visitas',
      churn: 'Mayor riesgo de fuga',
      name: 'Nombre A–Z',
    },
    noMatches: 'Sin coincidencias',
    noMatchesBody: 'Prueba con otra búsqueda o quita el filtro de segmento.',
    clearFilters: 'Quitar los filtros',
    empty: 'Todavía no hay miembros',
    emptyBody: 'Pon tu QR en el mostrador o añade a alguien desde el punto de venta.',
    emptyCta: 'Añadir a mi primer cliente',
    columns: {
      customer: 'Cliente',
      balance: 'Saldo',
      visits: 'Visitas',
      spend: 'Gasto',
      lastVisit: 'Última visita',
      status: 'Estado',
    },
    rewardReady: 'Lista',
    statusNeverVisited: 'Sin visitas',
    statusActive: 'Activo',
    statusAtRisk: 'En riesgo',
    statusLost: 'Perdido',
    pagination: '{from}–{to} de {total}',
    paginationLabel: 'Paginación',
    mobileSummary: '{visits} · {spend} · {when}',
    profile: {
      back: 'Todos los clientes',
      memberSince: 'Miembro desde el {date}',
      markVip: 'Marcar como VIP',
      removeVip: 'Quitar el VIP',
      visits: 'Visitas',
      totalSpend: 'Gasto total',
      averageTicket: 'Ticket medio',
      churnRisk: 'Riesgo de fuga',
      summarise: 'Resumir a este cliente',
      summaryEmpty: 'Todavía no hay historial suficiente.',
      summaryFailed: 'Ahora mismo no hemos podido generar el resumen.',
      loyalty: 'Fidelización',
      rewards: 'Recompensas',
      rewardFallback: 'Recompensa',
      membership: 'Suscripción',
      membershipFallback: 'Suscripción',
      signUp: 'Dar de alta',
      notAMember:
        'No es suscriptor. Los habituales con cuota mensual vienen más y gastan más.',
      periodsPaid_one: '{count} periodo · ha pagado {amount}',
      periodsPaid_other: '{count} periodos · ha pagado {amount}',
      ending: 'Termina',
      active: 'Activa',
      renewsOn: 'Se renueva el {date}',
      endsOn: 'Termina el {date}',
      cancelAtPeriodEnd: 'Cancelar al final del periodo',
      loadingPlans: 'Cargando los planes…',
      noPlans: 'Todavía no hay planes de suscripción.',
      createOne: 'Crear uno',
      couldNotEnrol: 'No hemos podido darle de alta',
      couldNotCancel: 'No hemos podido cancelarlo',
      consent: 'Consentimiento',
      consentEmail: 'Correo',
      consentSms: 'SMS',
      consentWhatsapp: 'WhatsApp',
      consentMarketing: 'Ofertas comerciales',
      consentLabel: 'Consentimiento de {channel}',
      consentUpdated: 'Actualizado el {date}',
      consentUpdatedVia: 'Actualizado el {date} vía {source}',
      notes: 'Notas',
      notesEmpty: 'Todavía no hay notas.',
      notePlaceholder: 'Alérgica a los frutos secos. Siempre pide el flat white.',
      noteLabel: 'Nota nueva',
      addNote: 'Añadir la nota',
      noteFailed: 'No hemos podido guardar la nota',
      staff: 'Equipo',
      history: 'Historial',
      historyEmpty: 'Todavía no hay nada registrado.',
      via: 'vía {source}',
      messageFallback: 'Mensaje',
      skipped: 'omitido ({reason})',
      activity: {
        signup: 'Se unió al programa',
        visit: 'Visita registrada',
        purchase: 'Compra',
        redeem: 'Recompensa canjeada',
        referral: 'Recomendó a un amigo',
        survey: 'Dejó su opinión',
        tier_change: 'Cambió de nivel',
        gift_card: 'Usó una tarjeta regalo',
        wallet_add: 'Añadió la tarjeta al wallet',
      },
    },
    importer: {
      back: 'Clientes',
      title: 'Importar clientes',
      subtitle:
        'Trae tu lista actual. Los saldos vienen con ella, así que nadie pierde su progreso.',
      chooseFile: 'Elige un archivo CSV',
      reading: 'Leyendo tu archivo…',
      accepts:
        'Funcionan las exportaciones de Square, Toast, Mailchimp y las hojas de cálculo normales',
      readFailed: 'No hemos podido leer ese archivo',
      startFailed: 'No hemos podido iniciar la importación',
      checkColumns: 'Revisa las columnas',
      matched:
        'Hemos emparejado {matched} de {total} columnas automáticamente. Ajusta lo que no cuadre.',
      skipColumn: 'Omitir esta columna',
      needsIdentifier:
        'Empareja al menos una columna de correo o de teléfono: necesitamos una de las dos para identificar a cada cliente.',
      preview: 'Vista previa',
      rowsTotal: '{count} filas en total. Los clientes existentes se actualizan, no se duplican.',
      chooseAnother: 'Elegir otro archivo',
      importCta_one: 'Importar {count} cliente',
      importCta_other: 'Importar {count} clientes',
      started: 'Importación iniciada',
      startedBody:
        'Se están procesando {count} filas en segundo plano. Puedes seguir trabajando: tu lista de clientes se irá llenando en los próximos minutos.',
      backToCustomers: 'Volver a los clientes',
      fields: {
        email: 'Correo',
        phone: 'Teléfono',
        name: 'Nombre',
        first_name: 'Nombre de pila',
        last_name: 'Apellidos',
        birthday: 'Cumpleaños',
        balance: 'Saldo',
        visits: 'Visitas',
        spend: 'Gasto',
        tags: 'Etiquetas',
        notes: 'Notas',
        created_at: 'Fecha de alta',
        external_id: 'Tu propia referencia',
      },
    },
  },

  rewards: {
    title: 'Recompensas',
    subtitle: 'Lo que ganan tus clientes y cuánto les cuesta conseguirlo',
    newReward: 'Nueva recompensa',
    editReward: 'Editar la recompensa',
    goalLine: '{goal} {unit} para una recompensa',
    openEnded: 'Programa de {unit} sin objetivo fijo',
    optimise: '¿Está bien planteado mi programa?',
    aiAssessment: 'Valoración de la IA',
    verdict: {
      too_easy: 'Demasiado fácil',
      well_balanced: 'Bien equilibrado',
      too_hard: 'Demasiado difícil',
    },
    members: 'Miembros',
    outstanding: 'Saldo pendiente',
    activeRewards: 'Recompensas activas',
    empty: 'Todavía no hay recompensas',
    emptyBody:
      'Añade eso por lo que trabajan tus clientes: un café gratis, un 10 % de descuento, un corte gratis.',
    emptyCta: 'Crear mi primera recompensa',
    editLabel: 'Editar {name}',
    auto: 'Automática: {trigger}',
    costLabel: '{cost} {unit}',
    stockLeft_one: 'Queda {count}',
    stockLeft_other: 'Quedan {count}',
    claimed_one: 'Canjeada {count} vez',
    claimed_other: 'Canjeada {count} veces',
    neverClaimed: 'Todavía sin canjear',
    nobodyClaimed:
      'Nadie la ha canjeado. Puede que cueste demasiado o simplemente no atraiga.',
    formSubtitle: 'Que sea algo que un habitual pueda alcanzar en unas pocas visitas.',
    name: 'Recompensa',
    namePlaceholder: 'Café gratis',
    description: 'Descripción',
    descriptionPlaceholder: 'Cualquier bebida hasta un latte grande',
    cost: 'Coste en {unit}',
    costHint:
      'Con {cost} {unit}, un cliente que viene cada semana lo alcanza en unas {weeks} semanas. Menos de seis semanas mantiene el interés.',
    availableLabel: 'Disponible para los clientes',
    availableHint: 'Las recompensas en pausa siguen en tu historial',
    createCta: 'Crear la recompensa',
    defaultUnit: 'puntos',
  },

  giftCards: {
    title: 'Tarjetas regalo',
    subtitle: 'Dinero en la caja hoy por algo que sirves más adelante',
    why: 'Por qué los negocios las activan',
    whyCashTitle: 'Cobras por adelantado',
    whyCashBody: 'Cobras hoy y sirves el café cuando vengan.',
    whyNewTitle: 'Clientes nuevos',
    whyNewBody:
      'Una tarjeta regalo la compra una persona y la canjea otra, casi siempre alguien que nunca había entrado.',
    whyBreakageTitle: 'Saldo sin gastar',
    whyBreakageBody: 'Casi ninguna tarjeta se canjea del todo. Ese resto es margen.',
    shopWouldLiveAt: 'Tu tienda estaría en {path}',
    upsellTitle: 'Empieza a vender tarjetas regalo',
    upsellBody: 'Un enlace, compartible donde quieras. Cobras en cuanto alguien compra.',
    copyShopLink: 'Copiar el enlace de la tienda',
    issueCard: 'Emitir una tarjeta',
    sold30: 'Vendido en los últimos 30 días',
    sold30Hint: 'Dinero cobrado en los últimos 30 días por venta de tarjetas regalo.',
    outstanding: 'Saldo pendiente',
    outstandingHint:
      'Lo que tus clientes todavía pueden gastar. Es un pasivo, no un ingreso: debes esa mercancía.',
    redeemed: 'Canjeado',
    redeemedHint: 'Valor ya gastado en tienda. Es la parte que se ha convertido en visitas.',
    activeCards: 'Tarjetas activas',
    activeCardsHint: 'Tarjetas que todavía tienen saldo.',
    onlineShop: 'Tu tienda online de tarjetas regalo',
    searchPlaceholder: 'Busca por código, nombre o correo',
    searchLabel: 'Buscar tarjetas regalo',
    filter: {
      all: 'Todas las tarjetas',
      active: 'Activas',
      depleted: 'Agotadas',
      expired: 'Caducadas',
      void: 'Anuladas',
    },
    scheduled: 'Programada',
    noMatches: 'Ninguna tarjeta coincide',
    noMatchesBody: 'Prueba con otro código, nombre o correo.',
    empty: 'Todavía no hay tarjetas regalo',
    emptyBody:
      'Comparte el enlace de tu tienda o emite una en el mostrador para quien pague en efectivo.',
    emptyCta: 'Emitir mi primera tarjeta',
    tableCaption: 'Tarjetas regalo',
    columns: {
      code: 'Código',
      recipient: 'Destinatario',
      balance: 'Saldo',
      issued: 'Emitida',
      status: 'Estado',
    },
    ofTotal: 'de {amount}',
    cancelCard: 'Anular la tarjeta {code}',
    cancelCardTitle: 'Anular esta tarjeta',
    issued: 'Tarjeta emitida',
    issuedOnItsWay: 'De camino a {email}.',
    issuedWriteCode: 'Apunta este código en la tarjeta que entregues.',
    issueTitle: 'Emitir una tarjeta regalo',
    issueSubtitle: 'Para quien pague en el mostrador, o como detalle.',
    amount: 'Importe',
    amountLabel: 'Importe de la tarjeta regalo',
    recipientName: '¿Para quién es?',
    recipientNamePlaceholder: 'María',
    emailIt: 'Enviársela por correo',
    emailItHint: 'Desactívalo si vas a entregar una tarjeta impresa',
    recipientEmail: 'Su correo',
    message: 'Un mensaje corto',
    messagePlaceholder: '¡Feliz cumpleaños! Un café a nuestra cuenta.',
    issueAmountCta: 'Emitir una tarjeta de {amount}',
    issueFailed: 'No hemos podido emitir la tarjeta',
  },

  memberships: {
    title: 'Suscripciones',
    subtitle: 'Ingresos que llegan llueva o no llueva',
    whatItDoes: 'Qué hace realmente una suscripción',
    whatItDoesBody:
      'Una tarjeta de sellos premia a quien vuelve. Una suscripción hace que decidan una sola vez, por adelantado, y luego sigue cobrando. Una cafetería que vende «19 € al mes, un café al día» a sesenta habituales tiene 1.140 € en el banco el día uno de cada mes, y esas sesenta personas ahora pasan de largo por delante de tu competencia para tomarse el café que ya han pagado.',
    predictableTitle: 'Ingresos previsibles',
    predictableBody:
      'Puedes hacer previsiones con un número de suscriptores. Con el paso de gente por la puerta, no.',
    frequencyTitle: 'Más frecuencia de visita',
    frequencyBody: 'Los suscriptores vienen más, porque no venir les parece desperdiciarlo.',
    priceTitle: 'Un motivo para cobrar más',
    priceBody: 'El saldo incluido y el multiplicador hacen que el precio parezca un descuento.',
    upsellTitle: 'Convierte a tus habituales en suscriptores',
    upsellBody:
      'Vende una cuota mensual, concede saldo automáticamente cada periodo y deja que acumulen más rápido.',
    newMembership: 'Nueva suscripción',
    editMembership: 'Editar la suscripción',
    mrr: 'Ingresos recurrentes mensuales',
    mrrHint:
      'Lo que aportan tus suscriptores activos cada mes. Las cuotas anuales se dividen entre doce.',
    activeMembers: 'Suscriptores activos',
    renewing30: 'Se renuevan en 30 días',
    renewing30Hint:
      'Suscriptores cuyo periodo termina pronto. Se les avisa tres días antes, así que el cobro nunca sorprende.',
    lifetimeRevenue: 'Ingresos acumulados',
    lifetimeRevenueHint: 'Todo lo que han aportado las suscripciones desde que empezaste.',
    tabPlans: 'Cuotas',
    tabMembers: 'Suscriptores',
    empty: 'Todavía no hay suscripciones',
    emptyBody:
      'Empieza por una. Una cuota mensual con el precio de unas ocho visitas es la forma que funciona.',
    emptyCta: 'Crear mi primera suscripción',
    noMembers: 'Todavía no se ha apuntado nadie',
    noMembersBody:
      'Da de alta a tus primeros suscriptores desde su ficha de cliente o en el mostrador.',
    perMonth: '/mes',
    perYear: '/año',
    archivePlan: 'Dejar de aceptar suscriptores nuevos',
    archiveLabel: 'Archivar {name}',
    editLabel: 'Editar {name}',
    multiplier: '{value}× puntos',
    includedBalance: '+{count} cada periodo',
    trialDays_one: '{count} día de prueba',
    trialDays_other: '{count} días de prueba',
    inviteOnly: 'Sólo con invitación',
    members: 'Suscriptores',
    contributing: 'Aportan',
    perMonthShort: '/mes',
    tableCaption: 'Suscriptores',
    columns: {
      member: 'Suscriptor',
      plan: 'Cuota',
      status: 'Estado',
      renews: 'Se renueva',
      paidSoFar: 'Pagado hasta ahora',
    },
    removedCustomer: 'Cliente eliminado',
    ending: 'Termina',
    active: 'Activa',
    formSubtitle:
      'Ponle un precio cercano a lo que un habitual ya se gasta en quince días. Tiene que parecer un descuento, no una suscripción.',
    name: 'Nombre',
    namePlaceholder: 'Club del Café',
    description: 'Qué se llevan los suscriptores',
    descriptionPlaceholder: 'Un café al día y puntos dobles en todo lo demás.',
    price: 'Precio',
    billed: 'Facturación',
    monthly: 'Mensual',
    yearly: 'Anual',
    pointsEachPeriod: 'Puntos por periodo',
    pointsEachPeriodHint: 'Se conceden automáticamente al renovar',
    earnMultiplier: 'Multiplicador de puntos',
    earnMultiplierHint: 'Además de su nivel',
    perks: 'Ventajas, una por línea',
    perksPlaceholder:
      'Sin cola\n10 % de descuento en café en grano\nLos primeros en conocer los nuevos tuestes',
    memberCap: 'Límite de suscriptores',
    memberCapPlaceholder: 'Déjalo vacío para ilimitado',
    memberCapHint:
      'Un límite crea escasez: «sólo 50 plazas» vende mejor que «apúntate cuando quieras».',
    acceptingMembers: 'Acepta suscriptores nuevos',
    acceptingMembersHint: 'A los actuales nunca les afecta',
    projection: 'Con {monthly} al mes, 50 suscriptores serían {total} de ingresos recurrentes.',
    createCta: 'Crear la suscripción',
  },

  campaigns: {
    title: 'Campañas',
    subtitle: 'Mensajes puntuales a un grupo concreto de clientes',
    newCampaign: 'Nueva campaña',
    empty: 'Todavía no hay campañas',
    emptyBodyAi:
      'Describe en una frase lo que quieres y deja que la IA escriba el primer borrador.',
    emptyBody: 'Crea un mensaje y envíalo a un segmento de tus clientes.',
    emptyCta: 'Crear mi primera campaña',
    channels: {
      email: 'Correo',
      sms: 'SMS',
      whatsapp: 'WhatsApp',
      push: 'Push',
      wallet: 'Wallet',
    },
    aiTag: 'IA',
    stats: {
      sent: 'Enviados',
      opened: 'Abiertos',
      revenue: 'Ingresos',
      roi: 'ROI',
    },
    willReach: 'Llegará a {count} clientes · unos {cost}',
    draftNoAudience: 'Borrador: todavía sin público',
    status: {
      draft: 'Borrador',
      scheduled: 'Programada',
      sending: 'Enviando',
      completed: 'Enviada',
      failed: 'Fallida',
      cancelled: 'Cancelada',
    },
    composerSubtitle: 'Elige a quién va, escríbelo una vez y mira el coste antes de enviar.',
    briefLabel: 'Describe lo que quieres',
    briefPlaceholder:
      'Recupera a los clientes que no vienen desde hace un mes, ofréceles un café gratis',
    generate: 'Escríbelo por mí',
    generateFailed: 'No hemos podido generar la campaña',
    saveFailed: 'No hemos podido guardar la campaña',
    name: 'Nombre de la campaña',
    namePlaceholder: 'Reactivación de marzo',
    untitled: 'Campaña sin título',
    audience: 'Quién la recibe',
    audiencePlaceholder: 'Elige un público',
    everyone: 'Todo el mundo',
    segmentCount: '{name} — {count} personas',
    reach: '{count} clientes',
    reachWithCost: '{count} clientes · unos {cost} en envío',
    channelsLabel: 'Canales',
    channelUnavailable: '{channel} no está configurado en este despliegue',
    emailSection: 'Correo',
    subject: 'Asunto',
    body: 'Mensaje',
    personalisation: 'Puedes usar {tokens} para personalizar.',
    smsSection: 'SMS',
    smsCount_one: '{characters} caracteres · {count} segmento por destinatario',
    smsCount_other: '{characters} caracteres · {count} segmentos por destinatario',
    smsUnicode: 'Contiene caracteres especiales, lo que acorta cada segmento.',
    saveDraft: 'Guardar como borrador',
    sendNow: 'Enviar ahora',
  },

  automations: {
    title: 'Automatizaciones',
    subtitleIdle: 'Configúralas una vez y trabajan mientras tú atiendes',
    subtitleActive_one: '{count} trabajando por ti las 24 horas',
    subtitleActive_other: '{count} trabajando por ti las 24 horas',
    empty: 'Todavía no hay automatizaciones',
    emptyBody:
      'Tu espacio suele venir con las automatizaciones de bienvenida, cumpleaños y reactivación listas.',
    toggleLabel: 'Activar o desactivar {name}',
    sent30: 'Enviadas (30 días)',
    allTime: 'Histórico',
    revenue: 'Ingresos',
    skipped_one:
      '{count} omitida: normalmente por consentimiento, horas de silencio o porque el cliente volvió solo.',
    skipped_other:
      '{count} omitidas: normalmente por consentimiento, horas de silencio o porque el cliente volvió solo.',
    triggers: {
      customer_joined: 'Cuando alguien se une',
      birthday: 'En su cumpleaños',
      anniversary: 'En su aniversario',
      inactivity: 'Cuando dejan de venir',
      reward_unlocked: 'Cuando se desbloquea una recompensa',
      reward_redeemed: 'Después de canjear',
      balance_expiring: 'Antes de que caduquen los puntos',
      tier_upgraded: 'Al subir de nivel',
      nps_promoter: 'Tras una buena valoración',
      nps_detractor: 'Tras una mala valoración',
      visit_recorded: 'En cada visita',
      purchase_recorded: 'En cada compra',
      referral_qualified: 'Cuando una recomendación cuaja',
      membership_renewal: 'Al renovar una suscripción',
    },
  },

  growth: {
    title: 'Crecer',
    subtitle: 'Tus clientes son tu canal de marketing más barato. Así se usa.',
    referredCustomers: 'Clientes recomendados',
    referredCustomersHint: 'Personas que se unieron porque las envió un cliente existente.',
    referredRevenue: 'Ingresos por recomendaciones',
    referredRevenueHint: 'Gasto acumulado de todos los que llegaron por una recomendación.',
    nps: 'Net promoter score',
    npsHint:
      'Promotores menos detractores, en porcentaje. Por encima de 50 es excelente para un negocio local.',
    needsAttention: 'Requiere tu atención',
    needsAttentionHint: 'Clientes descontentos a los que todavía no ha contestado nadie.',
    tabReferrals: 'Recomendaciones',
    tabReviews: 'Reseñas',
    tabShare: 'Compartir',
    tabPartners: 'Recomendar un negocio',
    programTitle: 'Premios por recomendar',
    programBody:
      'Se premia a las dos partes: al amigo al registrarse y al recomendador sólo cuando el amigo compra algo de verdad. Eso es lo que evita que la gente se recomiende a sí misma.',
    programToggleLabel: 'Programa de recomendaciones activo',
    advocateGets: 'El recomendador se lleva',
    advocateGetsHint_one: 'Se paga tras la primera visita de su amigo',
    advocateGetsHint_other: 'Se paga tras las {count} visitas de su amigo',
    friendGets: 'El amigo se lleva',
    friendGetsHint: 'Al momento, cuando se une',
    saveRewards: 'Guardar los premios',
    noReferrals: 'Todavía no hay recomendaciones',
    noReferralsBody:
      'Cada cliente tiene su código en la tarjeta. Imprime el cartel con el QR y menciónalo en el mostrador: normalmente con eso arranca.',
    advocates: 'Tus recomendadores',
    advocatesSummary: '{qualified} de {total} recomendaciones convertidas ({rate})',
    advocateConverted: '{qualified} convertidas de {total} invitados',
    broughtIn: 'aportados',
    advocatesNote:
      'A esta gente vale la pena darle las gracias por su nombre. Un café gratis para tu mejor recomendador cuesta menos que cualquier anuncio, y lo contarán a todo el mundo.',
    reviewLoop: 'El circuito de reseñas',
    reviewLoopBody:
      'A los clientes contentos se les dirige a tu página pública de reseñas. Los descontentos hablan antes contigo, para que puedas arreglarlo antes de que escriban nada. A nadie se le impide reseñar: simplemente no le pedimos cinco estrellas a alguien treinta segundos después de decirnos que no estaba contento.',
    promoters: 'Promotores',
    passives: 'Pasivos',
    detractors: 'Detractores',
    clickedThrough: 'Han pasado a dejar reseña',
    distributionLabel: 'Distribución de puntuaciones',
    noReviewLink:
      'Todavía no has puesto un enlace de reseñas de Google, así que los promotores no tienen adónde ir.',
    addItInSettings: 'Añádelo en Ajustes',
    nothingToFix: 'No hay nada que arreglar',
    nothingToFixBody: 'Ningún cliente descontento espera respuesta. Ese es el objetivo.',
    unresolved: 'Clientes descontentos esperándote',
    unresolvedBody:
      'Un cliente que se queja y recibe respuesta es más fiel que uno que nunca se quejó.',
    aCustomer: 'Un cliente',
    markHandled: 'Marcar como resuelto',
    resolutionLabel:
      '¿Qué has hecho al respecto? Se guarda en su ficha para que lo sepa tu equipo.',
    resolutionPlaceholder:
      'La he llamado, me he disculpado por la espera y le he invitado a un café en su próxima visita.',
    yourLinks: 'Tus enlaces',
    joinLink: 'Unirse a tu programa de fidelización',
    joinLinkNote: 'Ponlo en el mostrador, en los tickets, en tu biografía de Instagram.',
    giftLink: 'Comprar una tarjeta regalo',
    giftLinkNote: 'Compártelo en diciembre y mira lo que pasa.',
    openLink: 'Abrir {label}',
    counterQr: 'QR para el mostrador',
    counterQrBody: 'Un PNG en alta resolución, listo para imprimir a cualquier tamaño.',
    qrAlt: 'Código QR que enlaza con tu página de alta',
    whatToSay: 'Qué decir exactamente',
    say1: '«Escanea esto y el siguiente ya te sale casi gratis.» En la caja, siempre.',
    say2: 'Pon el QR en el ticket. No cuesta nada y ya lo tienen en la mano.',
    say3: 'Publica el enlace de tarjetas regalo una vez por semana en diciembre.',
    say4: 'Cuando un habitual traiga a un amigo, menciona que los dos se llevan algo.',
    partnersUnavailable: 'No disponible',
    partnersUnavailableBody: 'No hay ningún código de recomendación para este espacio.',
    referBusiness: '¿Conoces otro negocio que necesite esto?',
    referBusinessBody:
      'Mándales tu enlace. Cuando empiecen a pagar, tú te llevas {credit} de saldo en tu próxima factura y ellos una prueba ampliada. Sin límite de cuántos.',
    copyLink: 'Copiar el enlace',
    businessesReferred: 'Negocios recomendados',
    creditEarned: 'Saldo conseguido',
    stillOnTrial: 'Todavía en prueba',
    whoYouSent: 'A quién has enviado',
    trialling: 'En prueba',
  },

  network: {
    title: 'Red de socios',
    subtitle: 'Intercambia clientes con los negocios de tu alrededor',
    howItWorks: 'Cómo funciona',
    howItWorksBody:
      'El gimnasio de al lado tiene 400 socios que no saben que existes. Tú tienes 600 que nunca han pisado un gimnasio. Asociaos, publicad una oferta para los clientes del otro y los dos os ponéis delante de un público que ya confía en un negocio local.',
    rule1:
      'La lista de clientes de nadie se comparte jamás. Tú publicas ofertas; nosotros las entregamos.',
    rule2: 'Las dos partes tienen que aceptar, y cualquiera puede terminarlo al instante.',
    rule3: 'Ves exactamente cuántos clientes te ha enviado cada acuerdo.',
    upsellTitle: 'Únete a la red local',
    upsellBody: 'Asóciate con negocios cercanos y pon tu oferta delante de sus clientes.',
    listed: 'Ya apareces en la red',
    listedBody:
      'Los negocios de {city} pueden encontrarte y enviarte una solicitud. Tú apruebas todas.',
    yourArea: 'tu zona',
    notListed: 'Únete a la red local',
    notListedBody:
      'No se comparte nada hasta que actives esto, y nada sobre tus clientes se comparte nunca.',
    participationLabel: 'Aparecer en la red de socios',
    bio: 'Cómo te ven los demás negocios',
    bioPlaceholder:
      'Tostador de café de especialidad en Calle Mayor. Punta de 8 a 11, sobre todo oficinistas.',
    saveBio: 'Guardar la descripción',
    invitations_one: '{count} invitación esperando',
    invitations_other: '{count} invitaciones esperando',
    accept: 'Aceptar',
    decline: 'Rechazar',
    tabPartners: 'Socios ({count})',
    tabDiscover: 'Descubrir',
    tabOffers: 'Ofertas',
    noPartners: 'Todavía no hay socios',
    noPartnersBody:
      'Busca un negocio cercano cuyos clientes quieran lo que tú vendes. Una cafetería y una librería encajan mejor que dos cafeterías.',
    searchPlaceholder: 'Busca negocios cerca de ti',
    searchLabel: 'Buscar en el directorio',
    nobodyNearby: 'Todavía no hay nadie cerca',
    nobodyNearbyBody:
      'Has llegado pronto. Según se vayan uniendo más negocios locales aparecerán aquí, y los que tú recomiendes salen primero.',
    ourOffers: 'Ofertas que publicas',
    newOffer: 'Nueva oferta',
    ourOffersEmpty: 'Publica una oferta y los clientes de tus socios podrán canjearla.',
    partnerOffers: 'Ofertas de tus socios',
    partnerOffersEmpty:
      'Todavía nada. Las ofertas de tus socios aparecen aquí y se canjean en tu mostrador.',
    endPartnership: 'Terminar',
    theySentYou: 'Te han enviado',
    youSentThem: 'Les has enviado',
    noTraffic: 'Todavía sin tráfico. Publica una oferta: un acuerdo sin oferta no hace nada.',
    partners: 'Socios',
    pending: 'Pendiente',
    invite: 'Invitar',
    fromBusiness: 'de {name}',
    claimedOf: 'Canjeada {count} de {limit}',
    claimedTimes_one: 'Canjeada {count} vez',
    claimedTimes_other: 'Canjeada {count} veces',
    offerTitle: 'Nueva oferta para socios',
    offerEditTitle: 'Editar la oferta',
    offerSubtitle:
      'Que merezca la pena caminar. «10 % de descuento» no mueve a nadie; «un café gratis con tu cuota del gimnasio» sí.',
    offerLabel: 'Oferta',
    offerPlaceholder: 'Café gratis para socios del gimnasio',
    offerDetails: 'Detalles',
    offerDetailsPlaceholder:
      'Enseña tu tarjeta del gimnasio en el mostrador. Cualquier bebida hasta un latte grande.',
    whoCanClaim: 'Quién puede canjearla',
    anyPartner: 'Clientes de cualquier socio',
    onlyPartner: 'Sólo {name}',
    totalClaims: 'Canjes totales',
    totalClaimsPlaceholder: 'Déjalo vacío para ilimitado',
    totalClaimsHint: 'Un límite protege tu margen y crea urgencia al mismo tiempo.',
    publishOffer: 'Publicar la oferta',
  },

  analytics: {
    title: 'Analítica',
    subtitle: 'Cómo está funcionando de verdad tu programa de fidelización',
    range7: 'Últimos 7 días',
    range30: 'Últimos 30 días',
    range90: 'Últimos 90 días',
    range365: 'Último año',
    repeatRate: 'Tasa de compra repetida',
    repeatRateHint:
      'Miembros que han venido más de una vez. La mejor medida de si la fidelización funciona.',
    retention: 'Retención (30 días)',
    retentionHint: 'Miembros activos en los últimos 30 días sobre el total de miembros.',
    churn: 'Fuga',
    churnHint: 'Miembros sin visitas desde hace más de 60 días.',
    clv: 'Valor de vida del cliente',
    clvHint: 'Gasto total medio registrado por miembro.',
    averageTicket: 'Ticket medio',
    visits: 'Visitas',
    rewardsClaimed: 'Recompensas canjeadas',
    outstanding: 'Saldo pendiente',
    outstandingHint:
      'Puntos y sellos que tienen tus clientes y todavía no han gastado. Es un pasivo.',
    monthlyGrowth: 'Crecimiento mensual',
    monthlyGrowthBody: 'Miembros nuevos y visitas por mes',
    newMembers: 'Miembros nuevos',
    notEnoughHistory: 'Todavía no hay historial suficiente',
    notEnoughHistoryBody:
      'Cuando tengas un mes de actividad, este gráfico te enseñará cómo estás creciendo.',
    cohorts: 'Retención por cohortes',
    cohortsBody: 'De la gente que se unió cada mes, cuántos seguían volviendo después',
    cohortJoined: 'Se unieron',
    cohortSize: 'Tamaño',
    cohortMonth: 'M{index}',
    topRewards: 'Recompensas más canjeadas',
    topRewardsEmpty: 'No se ha canjeado ninguna recompensa en este periodo.',
    topCustomers: 'Miembros de más valor',
    topCustomersEmpty: 'Todavía no hay miembros.',
  },

  insights: {
    title: 'Sugerencias con IA',
    subtitle: 'Lo que te están diciendo tus números',
    subtitleImpact: 'Hasta {amount} encima de la mesa ahora mismo',
    notConfigured: 'La IA no está configurada',
    notConfiguredBody:
      'Añade una clave de API de Anthropic a este despliegue para desbloquear la generación de campañas, la predicción de fuga y las sugerencias diarias.',
    refresh: 'Actualizar las sugerencias',
    empty: 'Todavía no hay sugerencias',
    emptyBody:
      'Las sugerencias se generan cada noche a partir de tu actividad. Genera una tanda ahora para ver qué destaca.',
    generate: 'Generar sugerencias',
    generating: 'Analizando…',
    dismiss: 'Descartar esta sugerencia',
    potential: '{amount} de potencial',
    confidence: '{percent} de confianza · {date}',
    severity: {
      info: 'Información',
      opportunity: 'Oportunidad',
      warning: 'Aviso',
      critical: 'Crítico',
    },
    kinds: {
      churn_risk: 'Riesgo de fuga',
      revenue_opportunity: 'Oportunidad de ingresos',
      program_health: 'Salud del programa',
      campaign_idea: 'Idea de campaña',
      customer_segment: 'Segmento de clientes',
      operations: 'Operativa',
    },
  },

  settings: {
    title: 'Ajustes',
    subtitle: 'Tu negocio, tu tarjeta, tu equipo',
    tabBusiness: 'Negocio',
    tabCard: 'Tarjeta',
    tabSignup: 'Alta',
    tabTeam: 'Equipo',
    businessDetails: 'Datos del negocio',
    name: 'Nombre del negocio',
    city: 'Ciudad',
    phone: 'Teléfono',
    supportEmail: 'Correo de soporte',
    website: 'Web',
    googleReviewUrl: 'Enlace de reseñas de Google',
    googleReviewUrlHint: 'Adónde se envía a los clientes contentos tras una buena valoración',
    currency: 'Moneda',
    language: 'Idioma',
    messagingRules: 'Reglas de mensajería',
    messagingRulesBody:
      'Protegen tu lista. Mandar de más es la forma más rápida de perder clientes.',
    quietStart: 'Inicio de las horas de silencio',
    quietEnd: 'Fin de las horas de silencio',
    weeklyCap: 'Máximo de mensajes por semana',
    weeklyCapHint: 'Por cliente y sumando todos los canales',
    saveRules: 'Guardar las reglas',
    channels: 'Canales e integraciones',
    channelsBody:
      'Lo que puede hacer este despliegue ahora mismo. Lo que esté apagado es una credencial que falta, no una función que falte.',
    channelEmail: 'Correo',
    channelSms: 'SMS',
    channelWhatsapp: 'WhatsApp',
    channelAppleWallet: 'Apple Wallet',
    channelGoogleWallet: 'Google Wallet',
    channelAi: 'Funciones de IA',
    channelBilling: 'Facturación',
    noteResend: 'Resend',
    noteTwilio: 'Twilio',
    noteMeta: 'Meta Cloud API',
    noteApple: 'Certificados de firma de pases',
    noteGoogle: 'Cuenta de servicio',
    noteAnthropic: 'Anthropic',
    noteStripe: 'Stripe',
    cardDesign: 'Diseño de la tarjeta',
    cardDesignBody: 'Esto es lo que ven tus clientes en Apple Wallet y Google Wallet.',
    cardDesignBullets: {
      templates: 'Once puntos de partida, de Minimalista a Lujo',
      colors: 'Tus colores, comprobando la legibilidad mientras eliges',
      logo: 'Tu logo, subido desde el móvil o el portátil',
      fields: 'Elige qué muestra la tarjeta: sellos, nivel, tienda, tus palabras',
    },
    openCardDesigner: 'Abrir el editor de la tarjeta',
    previewMember: 'Ana García',
    signupLink: 'Tu enlace de alta',
    signupLinkBody: 'Imprime este QR y ponlo en el mostrador. Esa es toda la configuración.',
    qrAlt: 'Código QR para unirse a {name}',
    copyLink: 'Copiar el enlace',
    signupNote:
      'El cliente escanea, escribe su correo y en unos quince segundos tiene la tarjeta en el móvil. No hay ninguna app que instalar.',
    team: 'Equipo',
    teamBody:
      'El personal puede registrar visitas y canjear recompensas. Los encargados además pueden lanzar campañas.',
    teamMember: 'Miembro del equipo',
    invitationPending: 'Invitación pendiente',
    lastActive: 'Última actividad el {date}',
    neverSignedIn: 'Nunca ha entrado',
    roles: {
      owner: 'Propietario',
      admin: 'Administrador',
      manager: 'Encargado',
      staff: 'Personal',
      viewer: 'Consulta',
    },
    palette: {
      midnight: 'Medianoche',
      espresso: 'Espresso',
      sage: 'Salvia',
      rose: 'Rosa',
      ink: 'Tinta',
      ocean: 'Océano',
    },
  },

  billing: {
    title: 'Plan y facturación',
    subtitle: 'Qué tienes contratado, qué estás usando y qué te daría subir',
    checkoutSuccess: 'Todo listo',
    checkoutSuccessBody: 'Tu plan está activo. Puede tardar unos segundos en aparecer abajo.',
    checkoutFailed: 'No hemos podido iniciar el pago',
    portalFailed: 'No hemos podido abrir el portal de facturación',
    trialBadge_one: 'Prueba — queda {count} día',
    trialBadge_other: 'Prueba — quedan {count} días',
    paymentFailed: 'Pago fallido',
    endsOn: 'Termina el {date}',
    endsAtPeriodEnd: 'Termina al final del periodo',
    trialBody:
      'Tienes acceso completo mientras lo pruebas todo. No hace falta tarjeta hasta que termine.',
    cancellingBody: 'Tu plan sigue activo hasta el final del periodo. Después no se borra nada.',
    delinquentBody:
      'Tu plan actual sigue disponible mientras resolvemos el pago. Actualiza la tarjeta para que todo siga funcionando con normalidad.',
    renewsOn: 'Se renueva el {date}',
    referralCredit: '{amount} de saldo por recomendaciones se aplica a tu próxima factura.',
    invoices: 'Facturas y pago',
    delinquentWarning:
      'No hemos podido cobrar. Actualiza la tarjeta o reactiva tu plan para que sigan funcionando las tarjetas del wallet, los QR y los escaneos. Tus clientes y tu historial quedan a salvo en cualquier caso.',
    dunningTitle: 'Qué pasa si falla un pago',
    dunningBody:
      'Reintentamos el cobro y te escribimos antes de cambiar nada. No se borra nada y tus datos siguen exactamente donde están.',
    usage: 'Uso',
    usageBody:
      'Los contadores mensuales se reinician el día uno. A nadie se le rechaza en el mostrador por un límite.',
    usageUnlimited: 'Tu plan no tiene límites. Usa lo que necesites.',
    plans: 'Planes',
    plansBody:
      'Todos los planes incluyen las tarjetas del wallet, el punto de venta y escaneos ilimitados para tu equipo.',
    monthly: 'Mensual',
    yearly: 'Anual',
    twoMonthsFree: '2 meses gratis',
    notConfigured:
      'El pago online no está configurado en este despliegue. Los planes se muestran como referencia; escríbenos para cambiar el tuyo.',
    mostPopular: 'El más elegido',
    yourPlan: 'Tu plan',
    custom: 'A medida',
    annualSaving: 'Ahorras {amount} al año',
    currentPlan: 'Plan actual',
    talkToUs: 'Hablemos',
    contactUnavailable: 'Consúltanos el precio',
    choosePlan: 'Elegir {plan}',
    included: 'Incluido',
    unavailable: 'No disponible',
    features: {
      campaigns: 'Campañas',
      automations: 'Automatizaciones',
      gift_cards: 'Tarjetas regalo',
      memberships: 'Suscripciones de pago',
      ai: 'Funciones de IA',
      advanced_analytics: 'Analítica avanzada',
      segments: 'Segmentos guardados',
      api_access: 'API REST',
      webhooks: 'Webhooks',
      coalition: 'Red de socios',
      multi_location: 'Varios locales',
      custom_branding: 'Marca personalizada',
      priority_support: 'Soporte prioritario',
      sso: 'Inicio de sesión único',
      team_management: 'Gestión de equipo',
      wallet_proximity: 'Tarjetas que reaccionan a la ubicación',
      geofencing: 'Geoperímetros',
      proximity_campaigns: 'Campañas por cercanía',
      automation_rules: 'Constructor de reglas',
    },
    limits: {
      customers: 'Clientes',
      locations: 'Locales',
      team_members: 'Miembros del equipo',
      messages_per_month: 'Mensajes este mes',
      ai_actions_per_month: 'Acciones de IA este mes',
      campaigns_per_month: 'Campañas este mes',
      proximity_campaigns: 'Campañas por cercanía',
      automation_rules: 'Reglas de automatización',
    },
  },

  /**
   * El texto de cara al comerciante del catálogo de planes.
   *
   * `lib/billing/plans.ts` guarda la *forma* de cada nivel —precios, funciones,
   * límites— y apunta a estas claves para las palabras. Los nombres de los
   * niveles se quedan en el catálogo: «Growth» es lo que el comerciante ve en su
   * factura, en los dos idiomas.
   */
  plans: {
    lapsed: {
      tagline: 'Tus datos están a salvo. Reactiva cuando quieras y vuelve a atender.',
    },
    starter: {
      tagline: 'Un programa de fidelización digital de verdad por menos que dos cafés al mes.',
      h1: 'Tarjetas de sellos y de puntos en Apple Wallet y Google Wallet',
      h2: 'Escáner de QR incluido: cualquier móvil, tablet u ordenador',
      h3: 'Un local y hasta 500 clientes',
      h4: 'Tu logo y tus colores en cada tarjeta',
      h5: 'Tarjetas que aparecen en la pantalla de bloqueo al pasar cerca',
    },
    growth: {
      tagline: 'Haz que vuelvan a propósito, no por casualidad.',
      h1: 'Todo lo de Starter y hasta 5.000 clientes',
      h2: 'Hasta 5 locales con informes por sitio',
      h3: 'Avisos en el wallet cuando pasan cerca de tu puerta',
      h4: 'Campañas por correo, SMS y WhatsApp',
      h5: 'Automatizaciones siempre activas: bienvenida, cumpleaños, reactivación',
      h6: 'Segmentos de clientes y el constructor de reglas sin código',
    },
    pro: {
      tagline: 'El equipo de marketing con IA que no tienes que contratar.',
      h1: 'Todo lo de Growth y hasta 25.000 clientes',
      h2: 'Campañas, sugerencias y resúmenes de clientes con IA',
      h3: 'Suscripciones de pago: tus propios ingresos recurrentes',
      h4: 'Predicción de fuga, valor de vida y retención por cohortes',
      h5: 'API REST, webhooks y marca personalizada',
      h6: 'Hasta 15 locales',
    },
    business: {
      tagline: 'Para grupos, franquicias y cualquier cosa con más de un encargado.',
      h1: 'Clientes, locales y equipo ilimitados',
      h2: 'Gestión de equipo con roles y personal por local',
      h3: 'Red de socios: intercambia clientes con negocios cercanos',
      h4: 'Inicio de sesión único y soporte prioritario',
      h5: 'Campañas por cercanía y reglas ilimitadas',
      h6: 'Nos encargamos nosotros de la migración',
    },
  },

  pos: {
    dialogTitle: 'Escanear a un cliente',
    dialogDescription:
      'Apunta la cámara a la tarjeta wallet, la tarjeta de fidelización, el código de premio o la tarjeta regalo del cliente. También puedes buscarlo por nombre.',
    noAccess: 'Sin acceso',
    noAccessBody:
      'Tu rol no puede atender clientes aquí. Pide acceso a un propietario o encargado.',
    backToDashboard: 'Volver al panel',
    scan: 'Escanear',
    served_one: '{count} atendido',
    served_other: '{count} atendidos',
    closeScanner: 'Cerrar el escáner',
    offline: 'Sin conexión: los escaneos se van guardando',
    syncing_one: 'Sincronizando {count} escaneo guardado',
    syncing_other: 'Sincronizando {count} escaneos guardados',
    torchOn: 'Encender la luz',
    torchOff: 'Apagar la luz',
    soundOn: 'Sonar en cada escaneo',
    soundOff: 'Silenciar el sonido del escaneo',
    switchCamera: 'Cambiar de cámara',
    cameraPreview: 'Vista de la cámara',
    reading: 'Leyendo…',
    pointCamera: 'Apunta la cámara a una tarjeta del wallet o toca un nombre de abajo',
    reconnecting: 'La cámara se está reconectando tras una pausa.',
    opening: 'Abriendo la cámara…',
    retryCamera: 'Volver a intentar con la cámara',
    queuedOffline: 'Guardado sin conexión. Se sincronizará cuando vuelvas a tener red.',
    scanFailed: 'No se ha podido procesar ese escaneo.',
    abandoned_one: '{count} escaneo guardado no se ha podido sincronizar',
    abandoned_other: '{count} escaneos guardados no se han podido sincronizar',
    abandonedBody: '{names}. Registra estas visitas a mano.',
    unknownCustomer: 'Cliente desconocido',
    ticketAmount: 'Importe del ticket',
    clearAmount: 'Borrar el importe del ticket',
    ticketNote:
      'El siguiente escaneo se registra como una compra de {amount} y aparecerá en tu panel en cuanto se sincronice.',
    backToCamera: 'Volver a la cámara',
    searchInstead: '¿Sin código? Busca al cliente por su nombre',
    readyForNext: 'Listo para el siguiente cliente',
    dismissResult: 'Descartar',
    duplicate: 'Ya se registró hace un momento',
    identified: 'Identificado',
    identifiedNoEarn: 'Identificado: tu rol no puede registrar visitas',
    awarded: '+{amount} {unit}',
    visitsCount_one: '{count} visita',
    visitsCount_other: '{count} visitas',
    rewardReady: 'Recompensa lista',
    toGo: 'Faltan {count}',
    progressLabel: 'Progreso hacia la recompensa: {balance} de {goal} {unit}',
    queuedBalance:
      'Guardado en este dispositivo: el saldo mostrado se actualiza al sincronizar.',
    waitingHandover: 'Pendiente de entregar',
    redeem: 'Canjear {name}',
    redeemed: '{name} canjeada: entrégasela.',
    redeemFailed: 'No hemos podido canjear eso',
    giftCardBalance: 'Saldo de la tarjeta regalo: {amount}',
    partnerOffer: 'Oferta de socio disponible: {title}',
    partnerOfferFrom: 'Oferta de socio disponible: {title} ({business})',
    giveThem: 'Entrégale {name}',
    handedOver: 'marcada como entregada',
    giftCardCode: 'Tarjeta regalo {code}',
    giftCardFor: 'para {name}',
    amountToTake: 'Importe a cobrar',
    wholeBalance: 'Todo el saldo ({amount})',
    take: 'Cobrar {amount}',
    taken: '{amount} cobrados',
    leftOnCard: 'Quedan {amount} en la tarjeta',
    cardEmpty: 'La tarjeta se ha quedado a cero',
    cannotTakePayment: 'Tu rol no puede cobrar de tarjetas regalo.',
    takeFailed: 'No hemos podido cobrar',
    referralFrom: 'Recomendación de {name}',
    referralBody:
      'Código {code}. Da de alta al cliente nuevo y {name} recibe su premio automáticamente en la primera visita del amigo.',
    whichOne: '¿Cuál de ellos? · «{term}»',
    reward: 'Recompensa',
    notAMember: 'Todavía no es miembro',
    notAMemberBody:
      'Ese es un código de alta de {slug}. Pídele que lo abra en su móvil o añádelo desde la pantalla de Clientes.',
    notRecognised: 'No reconocido',
    searchLabel: 'Nombre, teléfono, correo o código',
    searchPlaceholder: 'Empieza a escribir…',
    tabRecent: 'Recientes',
    tabRegulars: 'Habituales',
    noMatches: 'No coincide nadie. Revisa la ortografía o pulsa Intro para probarlo como código.',
    noRecent: 'Todavía no hay visitas registradas. Busca a un cliente por su nombre.',
    noRegulars:
      'Todavía no hay habituales marcados. Marca con una estrella a tus mejores clientes.',
    neverVisited: 'sin visitas',
  },

  /**
   * La checklist posterior al onboarding.
   *
   * Todo lo que el asistente ha dejado deliberadamente de preguntar. Cada línea
   * enlaza con la pantalla que lo hace, así que aplazar una decisión nunca es lo
   * mismo que perderla.
   */
  checklist: {
    title: 'Primeros pasos',
    subtitle: 'Unos minutos cada uno, cuando te venga bien. Nada de esto bloquea el mostrador.',
    dismiss: 'Ocultar esta checklist',
    dismissed: 'Oculta. Puedes recuperarla desde Ajustes.',
    restore: 'Volver a mostrar la checklist',
    progress: '{done} de {total} hechos',
    allDone: 'Ya está todo. Tu configuración está completa.',
    items: {
      locations: 'Añade tus otros locales',
      locationsBody: 'Horarios, geoperímetros e informes por sitio.',
      proximity: 'Activa los avisos por cercanía',
      proximityBody: 'Tu tarjeta vuelve a tus clientes cuando pasan por delante.',
      cardDesign: 'Personaliza tu tarjeta Wallet',
      cardDesignBody: 'Elige una plantilla, pon tus colores y decide qué muestra la tarjeta.',
      /*
       * Reescrito para que no compita con el punto anterior. Antes se llamaba
       * "Personaliza la tarjeta" y llevaba a Ajustes, es decir: la única fila
       * del panel que mencionaba la tarjeta enviaba al comerciante a la
       * pantalla que no la contiene.
       */
      branding: 'Añade tu logo',
      brandingBody: 'Una sola subida. Aparece en tu tarjeta, tu página de alta y tus correos.',
      firstScan: 'Atiende a tu primer cliente',
      firstScanBody: 'Abre el escáner y registra a alguien: es cosa de un minuto.',
      campaign: 'Envía tu primera campaña',
      campaignBody: 'Una oferta de bienvenida para todos los que se han unido hasta ahora.',
      team: 'Invita a tu equipo',
      teamBody: 'El personal puede escanear y canjear sin ver tu facturación.',
    },
  },

  /**
   * Texto de cara al comerciante que se genera sin ninguna petición detrás.
   *
   * Un correo de impago lo manda un webhook, un aviso de límite lo dispara el
   * escaneo de otra persona, un recordatorio de renovación lo lanza un cron.
   * Ninguno tiene a un lector cuya cookie diga en qué idioma escribir, así que
   * resuelven `businesses.locale` — ver `lib/i18n/business.ts`. Sin este espacio
   * serían los últimos textos en inglés que recibiría un comercio español.
   */
  notify: {
    softLimitTitle: 'Se te ha quedado pequeño el plan {plan}',
    softLimitBody:
      '{limit}: {used} de {allowed}. Seguimos dando de alta a todo el mundo: no se está rechazando a nadie.',
    softLimitBodyUpgrade:
      '{limit}: {used} de {allowed}. Seguimos dando de alta a todo el mundo: no se está rechazando a nadie. Con {plan} sube el límite.',
    subscriptionEndedTitle: 'Tu suscripción ha terminado',
    subscriptionEndedBody:
      'Tu espacio está inactivo. Siguen aquí todos los clientes, tarjetas y campañas: reactívalo cuando quieras.',
    planActiveTitle: 'Ya estás en {plan}',
    planActiveBody: 'Todo lo de tu plan está desbloqueado. Nos alegra tenerte.',
    paymentFailedTitle: 'No hemos podido cobrar',
    paymentFailedBody:
      'Tu tarjeta ha sido rechazada. Lo volveremos a intentar: actualízala en facturación y no cambia nada.',
    paymentRecoveredTitle: 'Tu pago se ha completado',
    paymentRecoveredBody: 'Gracias. Tu plan vuelve a estar totalmente activo.',
    subscriptionLapsedTitle: 'Tu plan está en pausa',
    subscriptionLapsedBody:
      'Tras varios intentos no hemos podido cobrar, así que las escrituras quedan en pausa. No se ha borrado nada: reactívalo y vuelve todo tal cual.',

    /*
     * Avisos de alianzas, ventas y recuperación de servicio. Llegan a la bandeja
     * del propio comerciante, así que se resuelven con el idioma de ese
     * comerciante: el del *destinatario*, que en una invitación es el negocio
     * invitado y no el que la envía.
     */
    partnershipInviteTitle: 'Un negocio de la zona quiere aliarse',
    partnershipInviteBody:
      '{business} te ha invitado a intercambiar clientes. No se comparte nada hasta que aceptes.',
    partnershipInviteFallback: 'Un negocio cercano',
    partnershipAcceptedTitle: 'Han aceptado tu alianza',
    partnershipAcceptedBody: 'Ya podéis publicar ofertas para los clientes del otro.',
    giftCardSoldTitle: 'Tarjeta regalo vendida: {amount}',
    giftCardSoldForBody: 'Comprada para {name}. Eso es caja de hoy.',
    giftCardSoldBody: 'Pagada online. Eso es caja de hoy.',
    serviceRecoveryBody: 'Recuperación de servicio (puntuación {score}): {note}',
  },

  /**
   * Correos transaccionales que escribe la plataforma, no el comerciante.
   *
   * Deliberadamente sobrios: un problema de cobro no es el momento del tono
   * comercial, y todos dicen qué ha pasado, qué vamos a hacer y qué tiene que
   * hacer él, en ese orden.
   */
  emails: {
    /**
     * El marco en el que va envuelto todo el correo que sale.
     *
     * La plantilla llevaba `lang="es"` fijo en todos los mensajes enviados
     * mientras el enlace de su propio pie decía "Unsubscribe" en inglés: los
     * clientes de una cafetería española recibían un cuerpo en español con un
     * pie en inglés, y los de un negocio inglés recibían un cuerpo correcto
     * dentro de un marco que todo lector de pantalla anunciaba como español.
     * Ahora las dos mitades se resuelven con el idioma del negocio.
     */
    shell: {
      unsubscribe: 'Darse de baja',
      poweredBy: 'Con la tecnología de {product}',
      openCta: 'Abrir',
    },
    /**
     * Entrega y recibo de las tarjetas regalo.
     *
     * Una tarjeta regalo la compra una persona y la lee otra, y los dos correos
     * eran literales en inglés con importes y fechas en `en-GB`: lo más visible
     * para el cliente de todo lo que un comerciante puede vender con el
     * producto.
     */
    giftCard: {
      sentSubject: '{sender} te ha enviado una tarjeta regalo de {amount}',
      receivedSubject: 'Tienes una tarjeta regalo de {amount}',
      greetingNamed: 'Hola, {name}:',
      greeting: 'Hola:',
      fromSender: '{sender} te ha comprado una tarjeta regalo de {business}.',
      fromNobody: 'Tienes una tarjeta regalo de {business}.',
      codeLine: 'Tu código es {code} y tiene un saldo de {amount}.',
      showAtCounter: 'Muéstralo en el mostrador: sin app, sin cuenta y sin imprimir nada.',
      validUntil: 'Válida hasta el {date}.',
      noExpiry: 'No caduca.',
      seeShop: 'Ver la tienda',
      receiptSubject: 'Tu tarjeta regalo de {amount} para {business}',
      receiptHeading: 'Tarjeta regalo confirmada',
      receiptThanks: 'Gracias: tu tarjeta regalo de {amount} para {business} está confirmada.',
      receiptScheduled: 'Se enviará por correo a {recipient} el {date}.',
      receiptSent: 'Ya se ha enviado por correo a {recipient}.',
      receiptCode: 'El código es {code}, por si prefieres entregarlo tú mismo.',
    },
    /** Texto de reserva para los campos del aviso de renovación de membresía. */
    membership: {
      planFallback: 'membresía',
    },
    dunning: {
      firstSubject: 'No hemos podido cobrar el pago de {business}',
      firstBody:
        'Tu tarjeta ha sido rechazada, así que no ha podido renovarse tu suscripción {plan}. Lo intentaremos otra vez en unos días; mientras tanto no cambia nada y tus datos no se ven afectados. Si la tarjeta ha caducado o has cambiado de banco, actualizarla ahora te ahorra el reintento.',
      retrySubject: 'Seguimos sin poder cobrar el pago de {business}',
      retryBody:
        'Hemos vuelto a intentar el cobro y la tarjeta ha sido rechazada. Intento {attempt} de {maxAttempts}. Tu espacio funciona con normalidad y todos los clientes, tarjetas y campañas siguen intactos. Actualizar los datos de pago lo resuelve al instante.',
      finalSubject: 'Último intento antes de pausar {business}',
      finalBody:
        'Este es el último reintento. Si falla, tu espacio pasa a estado inactivo: tus datos se quedan exactamente donde están y todas las pantallas siguen funcionando, pero los clientes nuevos, las campañas y los cambios quedan en pausa hasta que se complete un pago.',
      lapsedSubject: '{business} está ahora en pausa',
      lapsedBody:
        'No hemos podido cobrar tras varios intentos, así que tu espacio está en pausa. No se ha borrado nada: todos los clientes, tarjetas, campañas y escaneos siguen aquí, y al reactivarlo vuelve todo de inmediato.',
      recoveredSubject: 'Pago recibido: {business} está totalmente activo',
      recoveredBody:
        'Tu pago se ha completado y todo vuelve a la normalidad. Gracias, y disculpa la interrupción.',
      cta: 'Actualizar los datos de pago',
      ctaReactivate: 'Reactivar mi plan',
    },
  },

  errors: {
    notFoundPageTitle: 'No hemos encontrado esa página',
    notFoundPageBody:
      'Puede que el enlace esté caducado o que la página se haya movido. No se ha perdido nada: tus datos siguen donde los dejaste.',
    notFoundHome: 'Volver al inicio',
    notFoundDashboard: 'Ir a mi panel',
    notFound: 'No encontrado',
    notFoundBody: 'La página que buscabas no está aquí.',
    forbidden: 'No tienes acceso a esto',
    forbiddenBody: 'Pide acceso a un propietario o administrador de este espacio.',
    paymentRequired: 'Tu plan no incluye esto',
    offline: 'Estás sin conexión',
    offlineBody:
      'Sigue atendiendo: los escaneos se guardan en este dispositivo y se envían en cuanto vuelva la conexión. No se pierde ninguna visita.',
    validation: 'Revisa los campos marcados.',
    /**
     * Cómo se lee en el navegador el sobre de error de la API.
     *
     * La API responde en un solo idioma porque no tiene vista; el comerciante lee
     * la respuesta en el suyo. Mapear aquí `error.code` es lo que impide que una
     * frase en inglés del servidor acabe en un aviso en español.
     */
    api: {
      unauthorized: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
      forbidden: 'Tu rol no permite hacer eso.',
      not_found: 'No hemos encontrado eso.',
      conflict: 'Eso ya se ha hecho.',
      rate_limited: 'Demasiadas peticiones. Espera un momento y vuelve a intentarlo.',
      payment_required: 'Tu plan no incluye eso.',
      not_configured: 'Eso todavía no está configurado en este despliegue.',
      internal_error: 'Algo ha fallado por nuestra parte. Inténtalo de nuevo.',
      network: 'No hemos podido contactar con el servidor. Revisa tu conexión y prueba otra vez.',
      upgradeFeature: '{feature} está disponible desde {plan}.',
      upgradeLimit: 'Tu plan incluye {allowed} {limit}. Estás usando {used}.',
      upgradeLapsed:
        'Tu suscripción está inactiva. Reactívala para hacer eso: no se ha borrado nada.',
    },

    /**
     * Rechazos por reglas de negocio, según el motivo que envía el servidor.
     *
     * `errors.api` cubre el transporte: sesión caducada, rol incorrecto, demasiadas
     * peticiones. Estos cubren el mostrador. Cada uno lo lee alguien del equipo con
     * un cliente delante, y por eso dicen qué hacer a continuación y no solo qué ha
     * fallado.
     */
    reason: {
      insufficient_balance: 'Todavía no hay saldo suficiente para ese premio.',
      out_of_stock: 'Ese premio está agotado.',
      tier_too_low: 'El nivel de este cliente aún no alcanza ese premio.',
      per_customer_limit: 'Este cliente ya ha canjeado ese premio el máximo de veces.',
      reward_unavailable: 'Ese premio ya no está disponible.',
      reward_not_started: 'Ese premio todavía no ha empezado.',
      no_active_program: 'Este negocio no tiene ningún programa activo. Crea uno en Premios.',
      customer_blocked: 'Este cliente está bloqueado. Desbloquéalo desde su perfil primero.',
      customer_anonymized: 'Los datos de este cliente se han borrado y no se pueden usar.',
      grant_not_found: 'Ese código no existe. Revisa los dígitos e inténtalo otra vez.',
      grant_already_used: 'Ese premio ya se ha usado.',
      grant_expired: 'Ese premio ha caducado.',
      grant_cancelled: 'Ese premio se canceló.',
      gift_card_inactive: 'Esa tarjeta regalo se ha agotado o se ha cancelado.',
      gift_card_expired: 'Esa tarjeta regalo ha caducado.',
      gift_card_empty: 'Esa tarjeta regalo no tiene saldo.',
    },
  },
}
