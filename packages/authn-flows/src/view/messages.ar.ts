export const ar: Readonly<Record<string, string>> = {
  'totp.title': 'إعداد تطبيق المصادقة',
  'totp.scan': 'امسح هذا الرمز ضوئيًا بتطبيق المصادقة، أو أدخل المفتاح يدويًا.',
  'totp.key': 'المفتاح:',
  'totp.codeLabel': 'الرمز من تطبيقك',
  'totp.confirm': 'تأكيد',
  'passkey.title': 'إضافة مفتاح مرور',
  'passkey.intro': 'سيطلب منك جهازك التأكيد. لن يُحفظ أي شيء حتى تؤكد.',
  'passkey.nameLabel': 'اسم مفتاح المرور',
  'passkey.namePlaceholder': 'مفتاح المرور',
  'passkey.submit': 'إضافة مفتاح المرور',
  'passkey.needsScript':
    'تتطلب إضافة مفتاح المرور تفعيل JavaScript، لأن المتصفح وحده يستطيع التواصل مع أداة المصادقة لديك.',
  'passkey.failed':
    'لم يُكمل جهازك إضافة مفتاح المرور — \u2068{reason}\u2069. يمكنك المحاولة مرة أخرى.',
  'passkey.cancelled': 'أُلغي الطلب',
  'recoveryCodes.title': 'احفظ رموز الاسترداد',
  'recoveryCodes.use':
    'يتيح كل رمز منها تسجيل الدخول مرة واحدة بدلًا من عامل المصادقة الثاني إذا فقدته.',
  'recoveryCodes.onlyTime': 'هذه هي المرة الوحيدة التي تُعرض فيها.',
  'recoveryCodes.keep':
    'اطبعها أو احفظها في مدير كلمات المرور قبل المتابعة — لا يستطيع أحد، ولا حتى المسؤول، عرضها لك مرة أخرى.',
  'recoveryCodes.replaced':
    'تحل هذه الرموز محل الرموز الصادرة لهذا الحساب سابقًا، ولم تعد تلك تعمل.',
  'recoveryCodes.acknowledge': 'لقد حفظت هذه الرموز',
  'link.backToSignIn': 'العودة إلى تسجيل الدخول',
  'requiredAction.title': 'خطوة إضافية',
  'requiredAction.pending': 'لدى هذا الحساب إجراء معلّق ({action}) لا يمكن إكماله هنا بعد.',
  'requiredAction.askAdmin': 'اطلب من أحد المسؤولين إكمال إعداد هذا الحساب.',
  'refusal.codeMismatch': 'الرمز غير مطابق. جرّب الرمز التالي الذي يعرضه تطبيقك.',
  'refusal.codesNotSaved': 'احفظ هذه الرموز قبل المتابعة.',
  'refusal.passkeyNotAdded': 'تعذّرت إضافة مفتاح المرور. حاول مرة أخرى.',

  'updatePassword.title': 'تغيير كلمة المرور',
  'updatePassword.intro': 'يحتاج هذا الحساب إلى كلمة مرور جديدة قبل أن تتمكن من المتابعة.',
  'updatePassword.newPassword': 'كلمة المرور الجديدة',
  'updatePassword.submit': 'تحديث كلمة المرور',
  'updatePassword.rule.minLength':
    'الحد الأدنى لطول كلمة المرور هو {min, number, ::group-off} من الأحرف.',
  'updatePassword.rule.maxLength':
    'الحد الأقصى لطول كلمة المرور هو {max, number, ::group-off} من الأحرف.',
  'updatePassword.rule.requireDigit': 'يجب أن تحتوي كلمة المرور على رقم.',
  'updatePassword.rule.requireUppercase': 'يجب أن تحتوي كلمة المرور على حرف كبير.',
  'updatePassword.rule.requireLowercase': 'يجب أن تحتوي كلمة المرور على حرف صغير.',
  'updatePassword.rule.requireSpecial': 'يجب أن تحتوي كلمة المرور على رمز خاص.',
  'updatePassword.rule.notUsername': 'يجب ألا تحتوي كلمة المرور على اسم المستخدم.',
  'updatePassword.rule.notEmail': 'يجب ألا تحتوي كلمة المرور على عنوان البريد الإلكتروني.',
  'updatePassword.hint.heading': 'تتطلب كلمة المرور:',
  'updatePassword.hint.minLength': '{min, number, ::group-off} من الأحرف على الأقل',
  'updatePassword.hint.digit': 'رقم',
  'updatePassword.hint.uppercase': 'حرف كبير',
  'updatePassword.hint.lowercase': 'حرف صغير',
  'updatePassword.hint.special': 'رمز خاص',
  'updatePassword.hint.notCommon': 'ألا تكون كلمة مرور شائعة',
  'updatePassword.hint.show': 'إظهار كلمة المرور',
  'updatePassword.hint.summary': 'استُوفي {met} من أصل {total} من القواعد',
  'updatePassword.rule.common': 'كلمة المرور هذه سهلة التخمين. اختر كلمة مرور أخرى.',
  'updatePassword.rule.notReused':
    'يجب ألا تكون كلمة المرور من كلمات المرور التي استخدمتها من قبل.',
  'updatePassword.rule.superseded':
    'تم تغيير كلمة مرورك في مكان آخر قبل إرسال هذا النموذج. سجّل الدخول مرة أخرى بكلمة المرور التي عيّنتها هناك.',
};
