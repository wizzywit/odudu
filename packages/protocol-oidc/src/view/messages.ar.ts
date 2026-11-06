export const ar: Readonly<Record<string, string>> = {
  'throttled.title': 'محاولات كثيرة جدًا',
  'throttled.retryAfter':
    'حاول مرة أخرى بعد {seconds, plural, zero {{seconds, number, ::group-off} ثانية} one {ثانية واحدة} two {ثانيتين} few {{seconds, number, ::group-off} ثوانٍ} many {{seconds, number, ::group-off} ثانية} other {{seconds, number, ::group-off} ثانية}}.',
  'throttled.goBack': 'عد إلى الصفحة السابقة عندما ينتهي الوقت.',

  'movedAddress.title': 'تم نقل هذا العنوان',
  'movedAddress.body':
    'لم يعد تسجيل الدخول متاحًا في هذا العنوان. تابع من العنوان الجديد بدلًا من ذلك:',

  'notFound.title': 'الصفحة غير موجودة',
  'notFound.body': 'لا يوجد شيء في هذا العنوان.',
  'notFound.link.console': 'افتح وحدة التحكم',
  'notFound.link.docs': 'اقرأ الوثائق',

  'serverError.title': 'حدث خطأ ما',
  'serverError.body': 'تعذّر على الخادم إكمال هذا الطلب. حاول مرة أخرى بعد قليل.',
  'serverError.requestId': 'معرّف الطلب: {id}',

  'error.title': 'خطأ في تسجيل الدخول',
  'error.heading': 'تعذّرت المتابعة',
  'error.wayOn.restart': 'ابدأ تسجيل الدخول من جديد',
  'error.wayOn.return': 'العودة إلى التطبيق',
  'error.signInExpired': 'محاولة تسجيل الدخول هذه لم تعد صالحة. ارجع وابدأ من جديد.',
  'error.noPendingAction': 'لا يوجد لهذا الحساب إجراء معلّق من هذا النوع.',
  'error.pendingActionNotReady': 'لا يمكن إكمال هذا الإجراء المعلّق هنا بعد.',
  'error.passwordTooLong': 'الحد الأقصى لطول كلمة المرور هو {max, number, ::group-off} من الأحرف.',
  'error.unknownTenant': 'مستأجر غير معروف.',
  'error.accountNotSignedIn': 'هذا الحساب ليس مسجّل الدخول حاليًا في هذا المتصفح.',

  'link.backToSignIn': 'العودة إلى تسجيل الدخول',
  'emailUnverified.title': 'تحقق من بريدك الإلكتروني',
  'emailUnverified.heading': 'لا يمكنك تسجيل الدخول بعد',
  'emailUnverified.body':
    '{mail, select, sent {أرسلنا إليك رابطًا للتحقق من عنوان بريدك الإلكتروني. افتحه ثم سجّل الدخول مرة أخرى.} other {يجب التحقق من بريدك الإلكتروني لتسجيل الدخول، لكن هذا الحساب لا يملك عنوانًا. اطلب المساعدة من المسؤول.}}',

  'login.title': 'تسجيل الدخول',
  'login.submit': 'تسجيل الدخول',
  'login.context': 'للمتابعة إلى {client}',
  'login.otp.title': 'أدخل رمز المصادقة',
  'login.recoveryCode.title': 'أدخل رمز استرداد',
  'login.verify': 'تحقق',
  'login.username': 'اسم المستخدم',
  'login.usernameOrEmail': 'اسم المستخدم أو البريد الإلكتروني',
  'login.password': 'كلمة المرور',
  'login.otp.code': 'الرمز من تطبيقك',
  'login.recoveryCode.label': 'أو رمز استرداد',
  'login.rememberMe': 'تذكّرني',
  'login.unsupportedStep': 'خطوة تسجيل دخول غير مدعومة: {form}',
  'login.passkey.submit': 'تسجيل الدخول بمفتاح مرور',
  'login.passkey.needsScript':
    'يتطلب تسجيل الدخول بمفتاح مرور تفعيل JavaScript، لأن المتصفح وحده يستطيع التواصل مع أداة المصادقة لديك. استخدم اسم المستخدم وكلمة المرور أعلاه.',
  'login.passkey.failed':
    'لم يُكمل جهازك تسجيل الدخول — \u2068{reason}\u2069. يمكنك المحاولة مرة أخرى.',
  'login.passkey.cancelled': 'أُلغي الطلب',
  'login.passkey.notOffered': 'هذا الخادم لا يوفّر مفاتيح المرور',
  'login.link.forgotPassword': 'نسيت كلمة المرور؟',
  'login.link.createAccount': 'إنشاء حساب',
  'login.refusal.signInFailed': 'تعذّر تسجيل الدخول. تحقق من بياناتك وحاول مرة أخرى.',
  'login.refusal.codeFailed': 'لم يعمل هذا الرمز. تحقق منه وحاول مرة أخرى.',
  'login.refusal.recoveryCodeFailed': 'لم يعمل رمز الاسترداد هذا. تحقق منه وحاول مرة أخرى.',
  'login.refusal.alreadyUsedRecoveryCode':
    'استخدمت رمز الاسترداد هذا من قبل. جرّب رمزًا آخر من قائمتك.',

  'consent.title': 'السماح بالوصول؟',
  'consent.heading': 'يطلب {client} الوصول',
  'consent.source.host': 'هذا التطبيق منشور على {host}',
  'consent.source.selfRegistered':
    'سجّل هذا التطبيق نفسه. لم يُعدّه أحد في هذا المستأجر، واسمه ادعاء منه.',
  'consent.source.more': '… و{count} أخرى',
  'consent.source.sentTo': 'بعد قرارك تُعاد توجيهك إلى:',
  'consent.source.otherRedirects': 'وسجّل أيضًا هذه العناوين:',
  'consent.source.redirects': 'بعد قرارك تُعاد توجيهك إلى أحد هذه العناوين:',
  'consent.link.about': 'نبذة عن {client}',
  'consent.link.privacy': 'سياسة الخصوصية',
  'consent.link.terms': 'شروط الخدمة',
  'consent.scope.offlineAccess': '{label} — يمنح وصولًا مستمرًا حتى في غيابك',
  'consent.scope.mcpRead':
    '{label} — يتيح للتطبيق الاطلاع على إعدادات هذا المستأجر وسجلاته نيابةً عنك',
  'consent.scope.mcpWrite': '{label} — يتيح للتطبيق تعديل إعدادات هذا المستأجر نيابةً عنك',
  'consent.allow': 'سماح',
  'consent.deny': 'رفض',

  'logout.confirm.title': 'تسجيل الخروج؟',
  'logout.confirm.body': 'يؤدي تسجيل الخروج إلى إنهاء هذه الجلسة في كل تطبيق يستخدمها.',
  'logout.confirm.submit': 'تسجيل الخروج',
  'logout.noSession.title': 'تم تسجيل الخروج بالفعل',
  'logout.noSession.body': 'لا توجد جلسة نشطة لإنهائها.',
  'logout.done.title': 'تم تسجيل الخروج',
  'logout.done.body': 'تم تسجيل خروجك.',
  'logout.redirecting.body': 'تم تسجيل خروجك. جارٍ إعادتك إلى التطبيق.',
  'logout.redirecting.continue': 'متابعة',
  'logout.redirectRefused.body':
    'تم تسجيل خروجك، لكن العنوان المحدد للعودة إليه بعد ذلك ليس من العناوين التي سجّلها هذا العميل، لذلك لم يُستخدم.',
  'logout.unauthenticated.title': 'تعذّر تسجيل الخروج',
  'logout.unauthenticated.body': 'محاولة تسجيل الخروج هذه لم تعد صالحة. ارجع وحاول مرة أخرى.',

  'selectAccount.title': 'اختر حسابًا',
  'selectAccount.useOther': 'استخدام حساب آخر',
};
