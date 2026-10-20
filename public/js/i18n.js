'use strict';

// English / Spanish for the public website, client login/sign-up and the client portal.
// Pages are written in English; when Spanish is chosen, visible text and labels that match an entry
// below are swapped in place (including text added later by scripts). Scripts build sentences with
// numbers or names through I18N.t('English {var}', { var }).
// The choice is remembered per browser; ?lang=es or ?lang=en in a link sets it too.
window.I18N = (() => {
  const STORE = 'aplus_lang';
  const read = () => { try { return localStorage.getItem(STORE); } catch { return null; } };
  const save = (v) => { try { localStorage.setItem(STORE, v); } catch { /* storage blocked */ } };

  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (fromUrl === 'es' || fromUrl === 'en') save(fromUrl);
  const browserEs = (navigator.languages || [navigator.language || '']).some((l) => /^es\b/i.test(l || ''));
  const lang = read() || (browserEs ? 'es' : 'en');
  document.documentElement.lang = lang;

  const ES = {
    /* ---------- Shared ---------- */
    'Skip to content': 'Saltar al contenido',
    'Email': 'Correo electrónico',
    'Phone': 'Teléfono',
    '(optional)': '(opcional)',
    'Name': 'Nombre',
    'Full name': 'Nombre completo',
    'Password': 'Contraseña',
    'Show': 'Mostrar',
    'Hide': 'Ocultar',
    'Show password': 'Mostrar contraseña',
    'Residence': 'Residencia',
    'Unit / room': 'Unidad / habitación',
    'Number of bedrooms': 'Número de habitaciones',
    'Number of bathrooms': 'Número de baños',
    'Select…': 'Selecciona…',
    'Studio': 'Estudio',
    'Anything else we should know?': '¿Algo más que debamos saber?',
    'Terms & Conditions': 'Términos y Condiciones',
    'Sign Out': 'Cerrar sesión',
    'Sign In': 'Iniciar sesión',
    'Sign in': 'Inicia sesión',
    'Back to website': 'Volver al sitio web',
    '← Back to website': '← Volver al sitio web',
    'Clean apartments.': 'Apartamentos limpios.',
    'No hassle.': 'Sin complicaciones.',
    'Clean apartments. No hassle.': 'Apartamentos limpios. Sin complicaciones.',
    'Leave the cleaning to the pros — so you can focus on being a student.': 'Deja la limpieza a los profesionales, para que puedas enfocarte en ser estudiante.',
    'A+ Cleaning Solutions home': 'Inicio de A+ Cleaning Solutions',
    'A+ Cleaning Solutions — back to home': 'A+ Cleaning Solutions — volver al inicio',
    'e.g. Maple Hall or street address': 'p. ej. Maple Hall o dirección',
    'Something went wrong.': 'Algo salió mal.',
    'Something went wrong. Please try again.': 'Algo salió mal. Inténtalo de nuevo.',
    'Weekly': 'Semanal',
    'Bi-Weekly': 'Quincenal',
    'Monthly': 'Mensual',
    'One-Time': 'Una vez',
    'One-time': 'Una vez',
    'Bi-weekly': 'Quincenal',
    // Common service names (orders and invoice lines)
    'Standard Clean': 'Limpieza estándar',
    'Deep Clean': 'Limpieza profunda',
    'Move-In Clean': 'Limpieza de mudanza (entrada)',
    'Move-Out Clean': 'Limpieza de mudanza (salida)',
    'Move-In / Move-Out Deep Clean': 'Limpieza profunda de mudanza',
    'Studio Standard Clean': 'Limpieza estándar · Estudio',
    '1 Bedroom / 1 Bathroom Standard Clean': 'Limpieza estándar · 1 habitación / 1 baño',
    '2 Bedroom / 2 Bathroom Standard Clean': 'Limpieza estándar · 2 habitaciones / 2 baños',
    '3 Bedroom / 3 Bathroom Standard Clean': 'Limpieza estándar · 3 habitaciones / 3 baños',
    '4 Bedroom / 4 Bathroom Standard Clean': 'Limpieza estándar · 4 habitaciones / 4 baños',
    '5 Bedroom / 5 Bathroom Standard Clean': 'Limpieza estándar · 5 habitaciones / 5 baños',
    'Cleaning service': 'Servicio de limpieza',
    'Scheduled': 'Programado',
    'Completed': 'Completado',
    'Cancelled': 'Cancelado',

    /* ---------- Website ---------- */
    'A+ Cleaning Solutions | Clean Apartments. No Hassle.': 'A+ Cleaning Solutions | Apartamentos limpios. Sin complicaciones.',
    'Professional dorm and student housing cleaning. Weekly, bi-weekly or monthly plans from vetted, trained cleaning teams — so students can focus on being students.': 'Limpieza profesional de dormitorios y viviendas estudiantiles. Planes semanales, quincenales o mensuales con equipos verificados y capacitados, para que los estudiantes se enfoquen en estudiar.',
    'Main': 'Principal',
    'Open menu': 'Abrir menú',
    'Services': 'Servicios',
    'Plans': 'Planes',
    'Campuses': 'Campus',
    'How It Works': 'Cómo funciona',
    'FAQ': 'Preguntas',
    'Contact': 'Contacto',
    'Client Login': 'Acceso clientes',
    'Book Today': 'Reserva hoy',
    'Student housing cleaning': 'Limpieza de vivienda estudiantil',
    'Apartments & shared spaces': 'Apartamentos y espacios compartidos',
    'Weekly, bi-weekly, or monthly plans': 'Planes semanales, quincenales o mensuales',
    'Vetted & trained cleaning teams': 'Equipos de limpieza verificados y capacitados',
    'View Plans': 'Ver planes',
    'Your history, online': 'Tu historial, en línea',
    'Every clean logged in your client portal': 'Cada limpieza registrada en tu portal de cliente',
    'Vetted & trained teams': 'Equipos verificados y capacitados',
    'Flexible scheduling': 'Horarios flexibles',
    'Built for student housing': 'Pensado para vivienda estudiantil',
    'Online order history': 'Historial de pedidos en línea',
    'A freshly cleaned dorm room with a made bed, tidy desk and plants': 'Un dormitorio recién limpiado con la cama hecha, escritorio ordenado y plantas',
    'What we clean': 'Qué limpiamos',
    'Everything a student space needs — nothing you have to think about.': 'Todo lo que necesita un espacio estudiantil, sin que tengas que pensar en nada.',
    'Between lectures, part-time jobs and exams, cleaning is the first thing to slip. Our teams keep dorms and shared living spaces fresh on a schedule that works for you.': 'Entre clases, trabajos de medio tiempo y exámenes, la limpieza es lo primero que se descuida. Nuestros equipos mantienen dormitorios y espacios compartidos impecables con un horario que te funcione.',
    'Dorm Rooms': 'Dormitorios',
    'Dusting, surfaces, desks, window sills, floors vacuumed and mopped, bins emptied and beds made — the full reset.': 'Polvo, superficies, escritorios, alféizares, pisos aspirados y trapeados, basureros vaciados y camas hechas: una puesta a punto completa.',
    'Shared Spaces': 'Espacios compartidos',
    'Suite bathrooms, kitchenettes, lounges and common areas — the spaces nobody wants to argue about cleaning.': 'Baños de suite, cocinetas, salas y áreas comunes: los espacios que nadie quiere discutir quién limpia.',
    'Move-In & Move-Out': 'Mudanza de entrada y salida',
    'Top-to-bottom deep cleans at the start and end of term. Start the year fresh and hand your room back spotless.': 'Limpiezas profundas de arriba abajo al inicio y fin del semestre. Empieza el año como nuevo y entrega tu habitación impecable.',
    'Residences & Landlords': 'Residencias y propietarios',
    'Recurring service for student residences, off-campus housing and property managers — one partner for every unit.': 'Servicio recurrente para residencias estudiantiles, viviendas fuera del campus y administradores de propiedades: un solo aliado para cada unidad.',
    'Pick a rhythm. We’ll handle the rest.': 'Elige la frecuencia. Nosotros nos encargamos del resto.',
    'Every plan includes the same vetted team, the same checklist and online access to your full cleaning history.': 'Cada plan incluye el mismo equipo verificado, la misma lista de tareas y acceso en línea a todo tu historial de limpiezas.',
    'Every week': 'Cada semana',
    'Always guest-ready': 'Siempre listo para visitas',
    'Ideal for shared suites': 'Ideal para suites compartidas',
    'Priority scheduling': 'Prioridad en la agenda',
    'Get a Quote': 'Pide una cotización',
    'Most popular': 'Más popular',
    'Every two weeks': 'Cada dos semanas',
    'The sweet spot for most students': 'La opción ideal para la mayoría de estudiantes',
    'Full room reset each visit': 'Habitación renovada en cada visita',
    'Easy to pause for exams & breaks': 'Fácil de pausar en exámenes y vacaciones',
    'Once a month': 'Una vez al mes',
    'A regular deep refresh': 'Una renovación profunda regular',
    'Great for tidy single rooms': 'Ideal para habitaciones individuales ordenadas',
    'Budget-friendly': 'Económico',
    'When you need it': 'Cuando lo necesites',
    'Move-in / move-out deep clean': 'Limpieza profunda de mudanza',
    'Before parents visit': 'Antes de que te visiten tus padres',
    'After a busy exam season': 'Después de una temporada de exámenes',
    'Pricing depends on room size and shared spaces. Tell us about your space and we’ll send a quote.': 'El precio depende del tamaño de la habitación y los espacios compartidos. Cuéntanos sobre tu espacio y te enviaremos una cotización.',
    'Where we clean': 'Dónde limpiamos',
    'Serving students near these campuses': 'Atendemos a estudiantes cerca de estas universidades',
    'Dorms, residences and off-campus student housing across the U.S. and Canada.': 'Dormitorios, residencias y viviendas estudiantiles fuera del campus en EE. UU. y Canadá.',
    'Don’t see your school?': '¿No ves tu universidad?',
    'Ask us': 'Pregúntanos',
    '— we’re growing fast.': '— estamos creciendo rápido.',
    'A+ Cleaning Solutions is an independent company and is not affiliated with or endorsed by these universities.': 'A+ Cleaning Solutions es una empresa independiente y no está afiliada ni respaldada por estas universidades.',
    'How it works': 'Cómo funciona',
    'Three steps to a cleaner semester.': 'Tres pasos para un semestre más limpio.',
    'Book your plan': 'Reserva tu plan',
    'Tell us your residence, room and preferred schedule. Scan the QR code on our flyers or use the form below.': 'Dinos tu residencia, habitación y horario preferido. Escanea el código QR de nuestros volantes o usa el formulario de abajo.',
    'We clean': 'Nosotros limpiamos',
    'A vetted, trained team arrives on schedule and follows our room checklist every single visit.': 'Un equipo verificado y capacitado llega a tiempo y sigue nuestra lista de tareas en cada visita.',
    'Track it online': 'Síguelo en línea',
    'Sign in to your client portal to see upcoming visits, past cleans and what you’ve paid — anytime.': 'Entra a tu portal de cliente para ver próximas visitas, limpiezas anteriores y lo que has pagado, cuando quieras.',
    'Client portal': 'Portal de cliente',
    'Your cleaning history, in one place.': 'Tu historial de limpieza, en un solo lugar.',
    'Every A+ client gets a secure login. No more digging through emails to find out when your next clean is.': 'Cada cliente de A+ recibe un acceso seguro. Se acabó buscar en tus correos para saber cuándo es tu próxima limpieza.',
    'Upcoming visits': 'Próximas visitas',
    '— see exactly when we’re coming next.': '— mira exactamente cuándo vamos la próxima vez.',
    'Full order history': 'Historial completo de pedidos',
    '— every clean, with notes from your team.': '— cada limpieza, con notas de tu equipo.',
    'Spending at a glance': 'Gastos de un vistazo',
    '— handy for budgeting (and for parents).': '— práctico para tu presupuesto (y para tus padres).',
    '📱 Get the App': '📱 Descarga la app',
    'Order history': 'Historial de pedidos',
    'Dorm Room Clean': 'Limpieza de dormitorio',
    'Bi-Weekly · Maple Hall': 'Quincenal · Maple Hall',
    'Dorm Room + Bathroom': 'Dormitorio + baño',
    'Move-In Deep Clean': 'Limpieza profunda de mudanza',
    'One-Time · Maple Hall': 'Una vez · Maple Hall',
    'Oct 28': '28 oct', 'Oct 14': '14 oct', 'Sep 30': '30 sep', 'Sep 2': '2 sep',
    'Who we serve': 'A quién servimos',
    'Made for everyone in student housing.': 'Hecho para todos en la vivienda estudiantil.',
    'Students': 'Estudiantes',
    'Get your time back for studying, sports and social life. Come home to a room that actually feels like home.': 'Recupera tu tiempo para estudiar, hacer deporte y tu vida social. Vuelve a una habitación que de verdad se sienta como hogar.',
    'Parents': 'Padres',
    'Give the gift of a clean, healthy space. Set up a plan for your student and follow along through the client portal.': 'Regala un espacio limpio y saludable. Contrata un plan para tu estudiante y síguelo desde el portal de cliente.',
    'Residences & Property Managers': 'Residencias y administradores de propiedades',
    'Reliable recurring service across multiple rooms and common areas, with clear records of every visit.': 'Servicio recurrente y confiable en múltiples habitaciones y áreas comunes, con registro claro de cada visita.',
    'Questions, answered.': 'Respuestas a tus preguntas.',
    'Who are your cleaners?': '¿Quiénes son sus limpiadores?',
    'Every A+ team member is vetted and trained on our dorm-cleaning checklist before their first visit, so you get the same standard every time.': 'Cada miembro del equipo de A+ es verificado y capacitado con nuestra lista de limpieza antes de su primera visita, para que recibas el mismo estándar siempre.',
    'Do I need to be in my room during the clean?': '¿Necesito estar en mi habitación durante la limpieza?',
    'No. Many clients schedule cleans while they’re in class. We’ll coordinate access with you (and your residence, where required) when you book.': 'No. Muchos clientes programan la limpieza mientras están en clase. Coordinaremos el acceso contigo (y con tu residencia, si es necesario) al reservar.',
    'Can I pause my plan over exams or breaks?': '¿Puedo pausar mi plan durante exámenes o vacaciones?',
    'Yes. Just let us know ahead of time and we’ll skip visits during reading week, holidays or exam season.': 'Sí. Avísanos con anticipación y omitiremos las visitas durante la semana de estudio, días festivos o temporada de exámenes.',
    'What’s included in a standard dorm clean?': '¿Qué incluye una limpieza estándar de dormitorio?',
    'Dusting and wiping surfaces, desks and sills; vacuuming and mopping floors; emptying bins; making the bed; and tidying shared areas included in your plan.': 'Quitar el polvo y limpiar superficies, escritorios y alféizares; aspirar y trapear pisos; vaciar basureros; hacer la cama; y ordenar las áreas compartidas incluidas en tu plan.',
    'How do I see my past and upcoming cleans?': '¿Cómo veo mis limpiezas anteriores y próximas?',
    'Once you book, we’ll set up your client login. Sign in at any time to see your full order history, upcoming visits and totals.': 'Cuando reserves, crearemos tu acceso de cliente. Inicia sesión cuando quieras para ver tu historial completo, próximas visitas y totales.',
    'Can a parent book on behalf of a student?': '¿Un padre o madre puede reservar por su estudiante?',
    'Absolutely. Parents can book and manage a plan — just include your student’s residence and room number when you reach out.': '¡Claro! Los padres pueden reservar y administrar un plan; solo incluye la residencia y el número de habitación de tu estudiante al contactarnos.',
    'Book today': 'Reserva hoy',
    'Let’s get your room sparkling.': 'Dejemos tu habitación reluciente.',
    'Tell us a little about your space and preferred plan. We’ll reply with a quote and available times.': 'Cuéntanos un poco sobre tu espacio y el plan que prefieres. Te responderemos con una cotización y horarios disponibles.',
    'Existing clients': 'Clientes actuales',
    'Sign in to view your order history': 'Inicia sesión para ver tu historial de pedidos',
    'Plan': 'Plan',
    'One-Time / Move-In / Move-Out': 'Una vez / Mudanza de entrada o salida',
    'Residence or property (multiple units)': 'Residencia o propiedad (varias unidades)',
    'Requested date': 'Fecha deseada',
    'Requested time': 'Hora deseada',
    'Shared bathroom, preferred days, move-in date…': 'Baño compartido, días preferidos, fecha de mudanza…',
    'Request My Quote': 'Solicitar cotización',
    'Thanks! Your request is in — we’ll be in touch shortly with a quote.': '¡Gracias! Recibimos tu solicitud; pronto te contactaremos con una cotización.',
    'Please include your name and a valid email address.': 'Incluye tu nombre y un correo electrónico válido.',
    'Already a client? Check your upcoming visits and order history anytime.': '¿Ya eres cliente? Revisa tus próximas visitas e historial de pedidos cuando quieras.',
    'Professional cleaning for dorm rooms and student housing. Leave the cleaning to the pros — so you can focus on being a student.': 'Limpieza profesional para dormitorios y vivienda estudiantil. Deja la limpieza a los profesionales, para que puedas enfocarte en ser estudiante.',
    'Explore': 'Explorar',
    'Get in touch': 'Contáctanos',
    'Book a clean': 'Reserva una limpieza',
    'A+ Cleaning Solutions. All rights reserved.': 'A+ Cleaning Solutions. Todos los derechos reservados.',
    '{message} You can also email info@apluscleaningsolution.com.': '{message} También puedes escribirnos a info@apluscleaningsolution.com.',

    /* ---------- 404 ---------- */
    'Page Not Found | A+ Cleaning Solutions': 'Página no encontrada | A+ Cleaning Solutions',
    'We swept everywhere…': 'Barrimos por todas partes…',
    '…but couldn’t find that page.': '…pero no encontramos esa página.',
    'Back to Home': 'Volver al inicio',

    /* ---------- Login ---------- */
    'Client Login | A+ Cleaning Solutions': 'Acceso clientes | A+ Cleaning Solutions',
    'Client login': 'Acceso de clientes',
    'Sign in to view your upcoming visits and order history.': 'Inicia sesión para ver tus próximas visitas e historial de pedidos.',
    'Don’t have an account?': '¿No tienes una cuenta?',
    'Create One': 'Crea una',
    'Forgot your password? Email': '¿Olvidaste tu contraseña? Escribe a',
    'and we’ll reset it for you.': 'y la restableceremos por ti.',
    'Enter your email and password.': 'Ingresa tu correo y contraseña.',
    'Signing in…': 'Iniciando sesión…',
    'Unable to sign in right now.': 'No es posible iniciar sesión en este momento.',
    'Too many sign-in attempts. Please wait 15 minutes and try again.': 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.',
    'That email and password combination doesn’t match our records.': 'Ese correo y contraseña no coinciden con nuestros registros.',
    'Thanks for signing up! Your account is waiting for approval. We’ll email you as soon as it’s ready.': '¡Gracias por registrarte! Tu cuenta está pendiente de aprobación. Te escribiremos en cuanto esté lista.',
    'Please sign in to continue.': 'Inicia sesión para continuar.',

    /* ---------- Sign-up ---------- */
    'Create an Account | A+ Cleaning Solutions': 'Crear una cuenta | A+ Cleaning Solutions',
    'Create your account': 'Crea tu cuenta',
    'Tell us about you and your place. We’ll review your details and email you as soon as your account is approved.': 'Cuéntanos sobre ti y tu vivienda. Revisaremos tus datos y te escribiremos en cuanto tu cuenta sea aprobada.',
    'e.g. 214': 'p. ej. 214',
    'Create a password': 'Crea una contraseña',
    'At least 8 characters': 'Al menos 8 caracteres',
    'Preferred days, access instructions, move-in date…': 'Días preferidos, instrucciones de acceso, fecha de mudanza…',
    'By creating an account you’ll be asked to review and agree to our': 'Al crear una cuenta, se te pedirá revisar y aceptar nuestros',
    'the first time you sign in.': 'la primera vez que inicies sesión.',
    'Create Account': 'Crear cuenta',
    'Creating account…': 'Creando cuenta…',
    'Already have an account?': '¿Ya tienes una cuenta?',
    'Thanks — request received!': '¡Gracias, solicitud recibida!',
    'Your account is waiting for approval. We’ll email': 'Tu cuenta está pendiente de aprobación. Escribiremos a',
    'as soon as it’s ready, usually within one business day. Then you can sign in with the password you just created.': 'en cuanto esté lista, normalmente en un día hábil. Luego podrás iniciar sesión con la contraseña que acabas de crear.',
    '← Back to sign in': '← Volver a iniciar sesión',
    'Enter your full name.': 'Ingresa tu nombre completo.',
    'Enter a valid email address.': 'Ingresa un correo electrónico válido.',
    'Enter a phone number we can reach you at.': 'Ingresa un teléfono donde podamos contactarte.',
    'Enter your residence or street address.': 'Ingresa tu residencia o dirección.',
    'Choose the number of bedrooms.': 'Elige el número de habitaciones.',
    'Choose the number of bathrooms.': 'Elige el número de baños.',
    'Choose the number of bedrooms and bathrooms.': 'Elige el número de habitaciones y baños.',
    'Choose a password of at least 8 characters.': 'Elige una contraseña de al menos 8 caracteres.',
    'Too many sign-up attempts. Please wait 15 minutes and try again.': 'Demasiados intentos de registro. Espera 15 minutos e inténtalo de nuevo.',
    'An account with that email already exists. Try signing in, or email us if you need help.': 'Ya existe una cuenta con ese correo. Intenta iniciar sesión o escríbenos si necesitas ayuda.',

    /* ---------- Client portal ---------- */
    'My Account | A+ Cleaning Solutions': 'Mi cuenta | A+ Cleaning Solutions',
    'Welcome back': 'Hola de nuevo',
    'Welcome back, {name}': 'Hola de nuevo, {name}',
    'Room {room}': 'Habitación {room}',
    'Book Another Clean': 'Reservar otra limpieza',
    'View Invoices': 'Ver facturas',
    'Summary': 'Resumen',
    'Next visit': 'Próxima visita',
    'Completed cleans': 'Limpiezas completadas',
    'all time': 'en total',
    'Total paid': 'Total pagado',
    'completed orders': 'pedidos completados',
    'Current plan': 'Plan actual',
    'None booked': 'Ninguna reservada',
    'Email us to book your next clean': 'Escríbenos para reservar tu próxima limpieza',
    '{n} upcoming visit': '{n} visita próxima',
    '{n} upcoming visits': '{n} visitas próximas',
    'Get the A+ app': 'Descarga la app de A+',
    '— see visits and pay invoices in one tap.': '— mira tus visitas y paga facturas con un toque.',
    'Install App': 'Instalar app',
    '🔔 Notify Me About Invoices': '🔔 Avísame de nuevas facturas',
    '✓ Invoice alerts on': '✓ Alertas de facturas activadas',
    'You’ll get a notification on this device when a new invoice arrives.': 'Recibirás una notificación en este dispositivo cuando llegue una nueva factura.',
    'Invoices': 'Facturas',
    'Filter orders': 'Filtrar pedidos',
    'All': 'Todos',
    'Upcoming': 'Próximos',
    'Date': 'Fecha',
    'Order': 'Pedido',
    'Service': 'Servicio',
    'Location': 'Ubicación',
    'Status': 'Estado',
    'Amount': 'Monto',
    'Loading your orders…': 'Cargando tus pedidos…',
    'No upcoming orders.': 'No hay pedidos próximos.',
    'No completed orders.': 'No hay pedidos completados.',
    'No cancelled orders.': 'No hay pedidos cancelados.',
    'You don’t have any orders yet. Once your first clean is booked it will appear here.': 'Aún no tienes pedidos. Cuando reserves tu primera limpieza, aparecerá aquí.',
    '{plan} plan': 'Plan {plan}',
    'Account': 'Cuenta',
    'Client since': 'Cliente desde',
    'Change password': 'Cambiar contraseña',
    'Current password': 'Contraseña actual',
    'New password': 'Nueva contraseña',
    '(min. 8 characters)': '(mín. 8 caracteres)',
    'Update Password': 'Actualizar contraseña',
    'Enter your current password and a new password of at least 8 characters.': 'Ingresa tu contraseña actual y una nueva de al menos 8 caracteres.',
    'Password updated. Other devices have been signed out.': 'Contraseña actualizada. Se cerró la sesión en tus otros dispositivos.',
    'Your current password is incorrect.': 'Tu contraseña actual es incorrecta.',
    'New password must be at least 8 characters.': 'La nueva contraseña debe tener al menos 8 caracteres.',
    'Questions about an order? Email': '¿Preguntas sobre un pedido? Escribe a',
    'We couldn’t load your account. {message} Please refresh to try again.': 'No pudimos cargar tu cuenta. {message} Actualiza la página para intentarlo de nuevo.',
    'We couldn’t load your orders. {message} Please refresh to try again.': 'No pudimos cargar tus pedidos. {message} Actualiza la página para intentarlo de nuevo.',
    'We couldn’t load your invoices. {message}': 'No pudimos cargar tus facturas. {message}',
    // Invoices
    'Due': 'Pendiente',
    'Paid': 'Pagada',
    'Overdue': 'Vencida',
    'Refunded': 'Reembolsada',
    'Total': 'Total',
    'Invoice {number}': 'Factura {number}',
    'Issued {date}': 'Emitida el {date}',
    'Due {date}': 'Vence el {date}',
    'Paid {date}': 'Pagada el {date}',
    '{date} at {time}': '{date} a las {time}',
    'Service:': 'Servicio:',
    'Pay {amount}': 'Pagar {amount}',
    'Opening secure checkout…': 'Abriendo pago seguro…',
    '🔒 Secure checkout by Stripe': '🔒 Pago seguro con Stripe',
    'View Receipt': 'Ver recibo',
    'Online payment coming soon — contact us at info@apluscleaningsolution.com to pay.': 'El pago en línea estará disponible pronto. Contáctanos en info@apluscleaningsolution.com para pagar.',
    'You have {n} unpaid invoice · {amount} due': 'Tienes {n} factura pendiente · {amount} por pagar',
    'You have {n} unpaid invoices · {amount} due': 'Tienes {n} facturas pendientes · {amount} por pagar',
    'Pay securely online by card in under a minute.': 'Paga de forma segura con tarjeta en menos de un minuto.',
    'Please contact us to arrange payment.': 'Contáctanos para coordinar el pago.',
    'Thank you! Invoice {number} is paid. A receipt has been emailed to you.': '¡Gracias! La factura {number} está pagada. Te enviamos el recibo por correo.',
    'Thanks! Your payment is processing and will show here shortly.': '¡Gracias! Tu pago se está procesando y aparecerá aquí en breve.',
    'Invoice not found.': 'Factura no encontrada.',
    'This invoice is already paid.': 'Esta factura ya está pagada.',
    'Online payment isn’t available right now. Please try again shortly or contact us.': 'El pago en línea no está disponible en este momento. Inténtalo más tarde o contáctanos.',
    'We couldn’t confirm the payment yet. It will update shortly.': 'Aún no pudimos confirmar el pago. Se actualizará en breve.',
    // Install / notifications
    'Install the app for one-tap access and notifications.': 'Instala la app para entrar con un toque y recibir notificaciones.',
    'On iPhone, notifications work once A+ is added to your Home Screen. Add it, open it from the Home Screen, then turn notifications on.': 'En iPhone, las notificaciones funcionan cuando A+ está en tu pantalla de inicio. Agrégala, ábrela desde la pantalla de inicio y activa las notificaciones.',
    'This browser doesn’t support notifications.': 'Este navegador no admite notificaciones.',
    'Add to your Home Screen': 'Agregar a tu pantalla de inicio',
    'Tap the <strong>Share</strong> button <span aria-hidden="true">⬆️</span> at the bottom (or top) of Safari.': 'Toca el botón <strong>Compartir</strong> <span aria-hidden="true">⬆️</span> en la parte inferior (o superior) de Safari.',
    'Scroll down and tap <strong>Add to Home Screen</strong>.': 'Desliza hacia abajo y toca <strong>Agregar a inicio</strong>.',
    'Tap <strong>Add</strong>. Then open the app from your Home Screen.': 'Toca <strong>Agregar</strong>. Luego abre la app desde tu pantalla de inicio.',
    'Got it': 'Entendido',
    // Terms pop-up
    'Terms and Conditions': 'Términos y Condiciones',
    'Welcome! One last step to open your account': '¡Te damos la bienvenida! Un último paso para abrir tu cuenta',
    'Please read our Terms & Conditions of Service, then type your full name and click Agree. You only need to do this once.': 'Lee nuestros Términos y Condiciones del Servicio, luego escribe tu nombre completo y haz clic en Acepto. Solo debes hacerlo una vez.',
    'Type your full name to sign': 'Escribe tu nombre completo para firmar',
    'I have read and agree to the A+ Cleaning Solutions Terms & Conditions of Service.': 'He leído y acepto los Términos y Condiciones del Servicio de A+ Cleaning Solutions.',
    'Agree': 'Acepto',
    'Saving…': 'Guardando…',
    'e.g. {name}': 'p. ej. {name}',
    'Type your full name to sign.': 'Escribe tu nombre completo para firmar.',
    'Tick the box to confirm you agree.': 'Marca la casilla para confirmar que aceptas.',
    'The terms were just updated. Please review the latest version.': 'Los términos se acaban de actualizar. Revisa la versión más reciente.',
    'Please review and accept the Terms & Conditions first.': 'Primero revisa y acepta los Términos y Condiciones.',
    'Courtesy translation. The English version of these Terms & Conditions is the one that applies and prevails if there is any difference.': 'Traducción de cortesía. La versión en inglés de estos Términos y Condiciones es la que aplica y prevalece en caso de cualquier diferencia.',
    '{company} · Terms & Conditions of Service · Version {version}': '{company} · Términos y Condiciones del Servicio · Versión {version}',

    /* ---------- Pay link page ---------- */
    'Pay Invoice | A+ Cleaning Solutions': 'Pagar factura | A+ Cleaning Solutions',
    'Loading your invoice…': 'Cargando tu factura…',
    'Hi {name},': 'Hola, {name}:',
    'Your invoice': 'Tu factura',
    'Here’s your invoice from A+ Cleaning Solutions. You can pay securely by card below.': 'Esta es tu factura de A+ Cleaning Solutions. Puedes pagar de forma segura con tarjeta aquí abajo.',
    'This invoice is paid — thank you!': 'Esta factura está pagada. ¡Gracias!',
    'This invoice was cancelled, so there’s nothing to pay.': 'Esta factura fue cancelada, así que no hay nada que pagar.',
    'Have an account?': '¿Tienes una cuenta?',
    'to see all your visits and invoices.': 'para ver todas tus visitas y facturas.',
    'Payment link not found': 'Enlace de pago no encontrado',
    'This payment link isn’t valid. Please check the link or contact us.': 'Este enlace de pago no es válido. Revisa el enlace o contáctanos.',
    'Thank you! Your payment went through. A receipt has been emailed to you.': '¡Gracias! Tu pago se realizó. Te enviamos el recibo por correo.',
    'Questions about this invoice? Email': '¿Preguntas sobre esta factura? Escribe a',

    /* ---------- Cleaner photo page ---------- */
    'Job Photos | A+ Cleaning Solutions': 'Fotos del trabajo | A+ Cleaning Solutions',
    'Job photos': 'Fotos del trabajo',
    'Loading your job…': 'Cargando tu trabajo…',
    'Job {number}': 'Trabajo {number}',
    'For {company}': 'Para {company}',
    'Submitted': 'Enviado',
    'To do': 'Pendiente',
    'Address': 'Dirección',
    'When': 'Cuándo',
    'Unit': 'Unidad',
    'Step 1 · Take before & after photos': 'Paso 1 · Toma fotos de antes y después',
    'Before photos when you arrive, after photos when you finish. At least one of each.': 'Fotos de antes al llegar y de después al terminar. Al menos una de cada una.',
    'Before ({n})': 'Antes ({n})',
    'After ({n})': 'Después ({n})',
    'None yet.': 'Ninguna todavía.',
    '📷 Add Before photos': '📷 Agregar fotos de antes',
    '📷 Add After photos': '📷 Agregar fotos de después',
    'Uploading {i} of {n}…': 'Subiendo {i} de {n}…',
    'Remove photo': 'Quitar foto',
    'Remove this photo?': '¿Quitar esta foto?',
    'Step 2 · Your name & submit': 'Paso 2 · Tu nombre y enviar',
    'Your full name': 'Tu nombre completo',
    'First and last name': 'Nombre y apellido',
    'Submit Job': 'Enviar trabajo',
    'Submitted — thank you!': '¡Enviado, gracias!',
    'Add at least one before photo and one after photo first.': 'Primero agrega al menos una foto de antes y una de después.',
    'Add at least one before photo and one after photo.': 'Agrega al menos una foto de antes y una de después.',
    'Enter your first and last name.': 'Ingresa tu nombre y apellido.',
    'Enter your full name (first and last).': 'Ingresa tu nombre completo (nombre y apellido).',
    '{n} photo uploaded.': '{n} foto subida.',
    '{n} photos uploaded.': '{n} fotos subidas.',
    '✓ Thank you,': '✓ Gracias,',
    '— your photos were sent for review. You can close this page.': '— tus fotos se enviaron para revisión. Ya puedes cerrar esta página.',
    'Link not available': 'Enlace no disponible',
    'Couldn’t load the job': 'No se pudo cargar el trabajo',
    'This link has expired or been turned off. Ask your supervisor for a new one.': 'Este enlace venció o fue desactivado. Pide uno nuevo a tu supervisor.',
    'Already submitted — ask your supervisor to send it back if you need to change photos.': 'Ya se envió. Pide a tu supervisor que lo devuelva si necesitas cambiar fotos.',
    'Already submitted. Thank you!': 'Ya se envió. ¡Gracias!',
    'Upload a JPG, PNG or WebP photo.': 'Sube una foto JPG, PNG o WebP.',

    /* ---------- Terms & Conditions body ---------- */
    'Terms & Conditions of Service': 'Términos y Condiciones del Servicio',
    '1. Scope of Services': '1. Alcance de los servicios',
    'Cleaning services will be performed as outlined in the agreed service proposal, work order, or service schedule. Services are limited to standard residential and common-area cleaning and do not include restoration services, biohazard cleanup, mold remediation, pest control, construction debris removal, or hazardous materials handling unless expressly agreed to in writing. Any modifications to the agreed scope of services must be confirmed in writing to be binding on either party.': 'Los servicios de limpieza se realizarán según lo establecido en la propuesta de servicio, orden de trabajo o calendario de servicio acordados. Los servicios se limitan a la limpieza residencial estándar y de áreas comunes y no incluyen servicios de restauración, limpieza de riesgos biológicos, remediación de moho, control de plagas, retiro de escombros de construcción ni manejo de materiales peligrosos, salvo acuerdo expreso por escrito. Cualquier modificación al alcance acordado debe confirmarse por escrito para ser vinculante para cualquiera de las partes.',
    '2. Access to Premises': '2. Acceso a las instalaciones',
    'The Client is responsible for providing timely access to all areas scheduled for service. The Service Provider is not responsible for delays, incomplete services, or additional charges resulting from restricted access, locked units, tenant non-cooperation, excessive clutter, or unsafe working conditions.': 'El Cliente es responsable de brindar acceso oportuno a todas las áreas programadas para el servicio. El Proveedor del Servicio no es responsable por retrasos, servicios incompletos o cargos adicionales derivados de acceso restringido, unidades cerradas, falta de cooperación de inquilinos, desorden excesivo o condiciones de trabajo inseguras.',
    '3. Occupied Student Housing Conditions': '3. Condiciones de vivienda estudiantil ocupada',
    'Cleaning services in occupied student housing are provided with the understanding that units are maintained in a reasonably sanitary condition. The Service Provider reserves the right to refuse, suspend, or modify services where conditions present health or safety risks, including but not limited to:': 'Los servicios de limpieza en viviendas estudiantiles ocupadas se prestan entendiendo que las unidades se mantienen en condiciones razonablemente sanitarias. El Proveedor del Servicio se reserva el derecho de rechazar, suspender o modificar los servicios cuando las condiciones representen riesgos para la salud o la seguridad, incluyendo, entre otros:',
    'Excessive filth, hoarding, or infestation (rodents, insects, or bedbugs)': 'Suciedad excesiva, acumulación compulsiva o infestación (roedores, insectos o chinches)',
    'Bodily fluids or biohazards': 'Fluidos corporales o riesgos biológicos',
    'Drug paraphernalia or needles': 'Parafernalia de drogas o agujas',
    'Aggressive or threatening behavior': 'Comportamiento agresivo o amenazante',
    'Structural or environmental hazards': 'Riesgos estructurales o ambientales',
    'Services refused or halted due to unsafe conditions will not be eligible for refunds.': 'Los servicios rechazados o detenidos por condiciones inseguras no serán elegibles para reembolso.',
    '4. Pricing & Additional Services': '4. Precios y servicios adicionales',
    'Pricing is based on standard conditions. Additional charges may apply for:': 'Los precios se basan en condiciones estándar. Pueden aplicarse cargos adicionales por:',
    'Excessive dirt, grease, or buildup': 'Suciedad, grasa o acumulación excesivas',
    'Post-event, party, or move-out conditions': 'Condiciones posteriores a eventos, fiestas o mudanzas',
    'Emergency or expedited services': 'Servicios de emergencia o urgentes',
    'Delays caused by tenant or building issues': 'Retrasos causados por inquilinos o problemas del edificio',
    'Where practical, additional charges will be communicated to the Client prior to proceeding.': 'Cuando sea posible, los cargos adicionales se comunicarán al Cliente antes de proceder.',
    '5. Damage Claims & Liability': '5. Reclamos por daños y responsabilidad',
    'The Service Provider will exercise reasonable care in performing services. Any claims for damage must be submitted in writing within 48 hours of service completion and must be accompanied by photographic documentation of the alleged damage. Liability, if any, shall be limited to the lesser of the cost of the service provided or the reasonable cost of repair. The Service Provider is not responsible for pre-existing damage, normal wear and tear, or damage caused by defective, unstable, or improperly installed fixtures or furnishings.': 'El Proveedor del Servicio actuará con cuidado razonable al prestar los servicios. Todo reclamo por daños debe presentarse por escrito dentro de las 48 horas siguientes a la finalización del servicio, acompañado de documentación fotográfica del daño alegado. La responsabilidad, si la hubiera, se limitará al menor entre el costo del servicio prestado o el costo razonable de reparación. El Proveedor del Servicio no es responsable por daños preexistentes, desgaste normal ni daños causados por accesorios o muebles defectuosos, inestables o mal instalados.',
    '6. Health, Safety & Right to Refuse Service': '6. Salud, seguridad y derecho a rechazar el servicio',
    'The Service Provider reserves the right to refuse or discontinue services if conditions pose a risk to personnel or property. The Client agrees that no refunds or credits will be issued for services discontinued due to unsafe or hazardous conditions beyond the Service Provider\'s control.': 'El Proveedor del Servicio se reserva el derecho de rechazar o suspender los servicios si las condiciones representan un riesgo para el personal o la propiedad. El Cliente acepta que no se emitirán reembolsos ni créditos por servicios suspendidos debido a condiciones inseguras o peligrosas fuera del control del Proveedor del Servicio.',
    '7. Cancellations & Scheduling': '7. Cancelaciones y programación',
    'Cancellations or rescheduling requests must be made with a minimum of 48 hours\' notice prior to the scheduled service time. Late cancellations or no-shows will be subject to a cancellation fee equal to 50% of the scheduled service value. Repeated late cancellations may result in suspension or termination of services.': 'Las cancelaciones o solicitudes de reprogramación deben hacerse con un mínimo de 48 horas de anticipación a la hora programada del servicio. Las cancelaciones tardías o ausencias estarán sujetas a un cargo de cancelación equivalente al 50% del valor del servicio programado. Las cancelaciones tardías reiteradas pueden resultar en la suspensión o terminación de los servicios.',
    '8. Payment Terms': '8. Condiciones de pago',
    'Invoices are due in accordance with the agreed payment terms. Late payments will be subject to interest at a rate of 1.5% per month (18% per annum), plus applicable administrative fees. The Service Provider reserves the right to suspend services for accounts in arrears and may require advance payment for recurring or large-scale services.': 'Las facturas vencen según las condiciones de pago acordadas. Los pagos atrasados estarán sujetos a intereses del 1.5% mensual (18% anual), más los cargos administrativos aplicables. El Proveedor del Servicio se reserva el derecho de suspender los servicios a cuentas con atrasos y puede exigir pago por adelantado para servicios recurrentes o de gran escala.',
    '9. Independent Contractor': '9. Contratista independiente',
    'The Service Provider is an independent contractor and is solely responsible for its employees, insurance, taxes, and compliance with applicable labor laws. Nothing in this agreement shall be construed to create an employment, partnership, or joint venture relationship between the parties.': 'El Proveedor del Servicio es un contratista independiente y es el único responsable de sus empleados, seguros, impuestos y del cumplimiento de las leyes laborales aplicables. Nada en este acuerdo se interpretará como la creación de una relación laboral, sociedad o empresa conjunta entre las partes.',
    '10. Indemnification & Hold Harmless': '10. Indemnización y exención de responsabilidad',
    'The Client agrees to indemnify and hold harmless the Service Provider from any claims, damages, losses, or expenses arising out of tenant actions, property conditions, or third-party conduct, except to the extent caused by the Service Provider\'s gross negligence or willful misconduct.': 'El Cliente acepta indemnizar y eximir de responsabilidad al Proveedor del Servicio frente a cualquier reclamo, daño, pérdida o gasto derivado de acciones de inquilinos, condiciones de la propiedad o conducta de terceros, salvo en la medida causada por negligencia grave o conducta dolosa del Proveedor del Servicio.',
    '11. Limitation of Liability': '11. Limitación de responsabilidad',
    'To the fullest extent permitted by law, the Service Provider shall not be liable for indirect, incidental, special, or consequential damages, including loss of use, loss of rental income, or business interruption.': 'En la máxima medida permitida por la ley, el Proveedor del Servicio no será responsable por daños indirectos, incidentales, especiales o consecuentes, incluida la pérdida de uso, pérdida de ingresos por alquiler o interrupción del negocio.',
    '12. Photography & Documentation': '12. Fotografía y documentación',
    'The Service Provider is authorized to take photographs and/or video recordings of service areas before and after each cleaning service for quality assurance, training, and damage dispute resolution purposes. Where reasonably practicable, prior notice will be provided to the Client or occupant. All documentation will be treated as confidential and used solely for internal quality assurance and dispute resolution. Images or recordings will not be shared publicly or with third parties without the Client\'s written consent, except as required by law.': 'El Proveedor del Servicio está autorizado a tomar fotografías y/o grabaciones de video de las áreas de servicio antes y después de cada limpieza, con fines de control de calidad, capacitación y resolución de disputas por daños. Cuando sea razonablemente posible, se dará aviso previo al Cliente u ocupante. Toda la documentación será tratada como confidencial y se usará únicamente para control de calidad interno y resolución de disputas. Las imágenes o grabaciones no se compartirán públicamente ni con terceros sin el consentimiento escrito del Cliente, salvo cuando lo exija la ley.',
    '13. Force Majeure': '13. Fuerza mayor',
    'Neither party shall be held liable for any failure or delay in the performance of its obligations under this agreement to the extent such failure or delay is caused by circumstances beyond its reasonable control, including but not limited to acts of God, fire, flood, earthquake, pandemic, epidemic, government-imposed restrictions, labor disputes or strikes, civil unrest, power failures, or other events of a similar nature (each, a "Force Majeure Event"). The affected party shall notify the other party as soon as reasonably practicable upon becoming aware of a Force Majeure Event and shall use commercially reasonable efforts to resume performance as soon as possible. Obligations suspended due to a Force Majeure Event shall resume upon resolution of the event.': 'Ninguna de las partes será responsable por el incumplimiento o retraso en sus obligaciones bajo este acuerdo en la medida en que se deba a circunstancias fuera de su control razonable, incluyendo, entre otras, casos fortuitos, incendio, inundación, terremoto, pandemia, epidemia, restricciones gubernamentales, conflictos laborales o huelgas, disturbios civiles, cortes de energía u otros eventos de naturaleza similar (cada uno, un "Evento de Fuerza Mayor"). La parte afectada notificará a la otra tan pronto como sea razonablemente posible al tener conocimiento de un Evento de Fuerza Mayor y hará esfuerzos comercialmente razonables para reanudar el cumplimiento lo antes posible. Las obligaciones suspendidas por un Evento de Fuerza Mayor se reanudarán al resolverse el evento.',
    '14. Confidentiality': '14. Confidencialidad',
    'Each party agrees to hold in strict confidence all non-public, proprietary, or sensitive information disclosed by the other party in connection with this agreement, including but not limited to pricing structures, client lists, property information, operational processes, and any information pertaining to tenants or students ("Confidential Information"). Neither party shall disclose, reproduce, or use any Confidential Information for any purpose other than the performance of services under this agreement without the prior written consent of the disclosing party. This obligation of confidentiality shall survive the termination or expiration of this agreement for a period of two (2) years. Nothing herein shall restrict either party from disclosing information required by applicable law or court order, provided that advance written notice is given to the other party where legally permissible.': 'Cada parte acepta mantener en estricta confidencialidad toda la información no pública, propietaria o sensible divulgada por la otra parte en relación con este acuerdo, incluyendo, entre otras, estructuras de precios, listas de clientes, información de propiedades, procesos operativos y cualquier información relativa a inquilinos o estudiantes ("Información Confidencial"). Ninguna de las partes divulgará, reproducirá ni usará Información Confidencial para fines distintos de la prestación de los servicios bajo este acuerdo sin el consentimiento previo por escrito de la parte que la divulga. Esta obligación de confidencialidad subsistirá durante dos (2) años tras la terminación o vencimiento de este acuerdo. Nada de lo aquí dispuesto impedirá a cualquiera de las partes divulgar información exigida por la ley aplicable o una orden judicial, siempre que se dé aviso previo por escrito a la otra parte cuando sea legalmente permitido.',
    '15. Governing Law & Venue': '15. Ley aplicable y jurisdicción',
    'This agreement shall be governed by and construed in accordance with the laws of the Province of Quebec and the federal laws of Canada applicable therein, without regard to conflict-of-law principles. Any disputes arising under this agreement shall be resolved in the appropriate courts of the Province of Quebec.': 'Este acuerdo se regirá e interpretará de conformidad con las leyes de la Provincia de Quebec y las leyes federales de Canadá aplicables en ella, sin considerar principios de conflicto de leyes. Cualquier disputa derivada de este acuerdo se resolverá ante los tribunales competentes de la Provincia de Quebec.',
    '16. Acceptance of Terms': '16. Aceptación de los términos',
    'Authorization or scheduling of services constitutes acceptance of these Terms & Conditions. These Terms & Conditions supersede any prior oral or written representations and constitute the entire agreement between the parties with respect to the subject matter herein.': 'La autorización o programación de servicios constituye la aceptación de estos Términos y Condiciones. Estos Términos y Condiciones reemplazan cualquier declaración previa, oral o escrita, y constituyen el acuerdo completo entre las partes con respecto a su objeto.',
  };

  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

  // Translate a phrase written in English; {placeholders} are filled from vars.
  function t(english, vars) {
    return fill(lang === 'es' && ES[english] != null ? ES[english] : english, vars);
  }

  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];

  // Text that is already Spanish is left alone, so a word that's the same in both languages
  // ("Plan", "Total") can't keep re-triggering the observer.
  const SPANISH = new Set(Object.values(ES));
  const lookup = (key) => (key && !SPANISH.has(key) ? ES[key] : undefined);

  function translateText(node) {
    const raw = node.nodeValue;
    const key = norm(raw);
    const es = lookup(key);
    if (!es || es === key) return;
    const parent = node.parentNode;
    // An <option> without a value submits its text: keep submitting the English value.
    if (parent && parent.nodeName === 'OPTION' && !parent.hasAttribute('value')) parent.setAttribute('value', key);
    const lead = raw.match(/^\s*/)[0];
    const trail = raw.match(/\s*$/)[0];
    node.nodeValue = lead + es + trail;
  }

  function translateEl(elm) {
    for (const a of ATTRS) {
      const v = elm.getAttribute && elm.getAttribute(a);
      const es = v && lookup(norm(v));
      if (es && es !== v) elm.setAttribute(a, es);
    }
  }

  function translateTree(root) {
    if (root.nodeType === Node.TEXT_NODE) { translateText(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    if (root.closest && root.closest('[data-no-translate], script, style')) return;
    translateEl(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && n.matches('[data-no-translate], script, style')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n.nodeType === Node.TEXT_NODE) translateText(n); else translateEl(n);
    }
  }

  function translatePage() {
    const title = lookup(norm(document.title));
    if (title) document.title = title;
    const desc = document.querySelector('meta[name="description"]');
    const descEs = desc && lookup(norm(desc.content));
    if (descEs) desc.content = descEs;
    translateTree(document.body);
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'childList') r.addedNodes.forEach(translateTree);
        else if (r.type === 'characterData') translateText(r.target);
        else if (r.type === 'attributes') translateEl(r.target);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  function setLang(next) {
    save(next);
    const url = new URL(window.location.href);
    url.searchParams.delete('lang');
    window.location.replace(url.toString());
  }

  // EN | ES switch, placed in the page header (or the top corner on login/sign-up pages).
  function addToggle() {
    const wrap = document.createElement('div');
    wrap.className = 'lang-toggle';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Language / Idioma');
    wrap.dataset.noTranslate = '';
    for (const [code, label, full] of [['en', 'EN', 'English'], ['es', 'ES', 'Español']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = full;
      b.lang = code;
      b.setAttribute('aria-pressed', String(code === lang));
      if (code !== lang) b.addEventListener('click', () => setLang(code));
      wrap.append(b);
    }
    const navToggle = document.querySelector('.site-header .nav > .nav-toggle');
    const slot = document.querySelector('.portal-user');
    if (navToggle) navToggle.before(wrap);
    else if (slot) slot.prepend(wrap);
    else {
      wrap.classList.add('lang-toggle-corner');
      (document.querySelector('.auth-panel, .error-page, main') || document.body).prepend(wrap);
    }
  }

  // Dates and times in the visitor's language.
  const locale = () => (lang === 'es' ? 'es-US' : 'en-CA');

  document.addEventListener('DOMContentLoaded', () => {
    addToggle();
    if (lang === 'es') translatePage();
  });

  return { lang, t, locale, setLang };
})();
