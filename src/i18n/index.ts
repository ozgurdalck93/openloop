/**
 * All user-facing copy, in English and Turkish. This is the single source of truth: the engine
 * (`suggestions.ts`, `transitions.ts`), the notification layer, the service layer and every
 * screen read their words from here rather than keeping their own bilingual tables.
 *
 * The UI language is either the device locale (`getUiLang`) or a user override stored in
 * `settings` and served through `useLanguage()` (`@/store/language`) — screens should read
 * `lang` from that hook, not call `getUiLang()` directly, so a runtime switch takes effect
 * everywhere at once.
 */
import type { Issue, IssueCode, Uncertainty } from '@/engine/candidateEdit';
import type { HomeSection } from '@/engine/sections';
import type { LoopAction } from '@/engine/suggestions';
import type { LoopEventType, LoopType } from '@/engine/types';
import type { NotificationActionId } from '@/notifications/categories';
import { uiLanguageForLocale } from '@/utils/locale';

export type UiLang = 'en' | 'tr';

/** The device locale (e.g. "tr-TR"), or undefined where the runtime has no Intl. */
export function getDeviceLocale(): string | undefined {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

export const getUiLang = (locale: string | undefined = getDeviceLocale()): UiLang => uiLanguageForLocale(locale);

/** "Send the link" → "send the link" — English reads better mid-sentence ("You said you'd send…"). */
const lowerFirst = (title: string): string => (title ? title.charAt(0).toLowerCase() + title.slice(1) : title);

interface Copy {
  title: string;
  body: string;
}

export interface Strings {
  uncertainty: Record<Uncertainty, string>;
  issue: Record<IssueCode, string>;
  /** Field labels in the editor. */
  field: { title: string; type: string; person: string; when: string; note: string; date: string; time: string };
  remove: string;
  noReminder: string;
  nothingLeft: string;
  fixFirst: string;
  back: string;
  updates: {
    confirm: string;
    chooseAnother: string;
    which: string;
    skip: string;
    resolved: (title: string) => string;
    stillWaiting: (title: string) => string;
    reschedule: (title: string, when: string) => string;
    dismiss: (title: string) => string;
    unmatched: (said: string) => string;
    noTime: string;
  };
  home: {
    title: string;
    emptyHeading: string;
    emptyBody: string;
    cta: string;
    sections: Record<HomeSection, string>;
    summary: { needsYou: (n: number) => string; waiting: (n: number) => string; comingUp: (n: number) => string };
  };
  capture: {
    title: string;
    placeholder: string;
    cta: string;
    ctaBusy: string;
    voiceCta: string;
    nothingFoundHint: string;
  };
  review: {
    title: string;
    keepCta: string;
    notNowCta: string;
    nothingToReview: string;
    noGuessDisclaimer: string;
  };
  detail: {
    notFound: string;
    context: string;
    closesWhen: string;
    linked: string;
    timeline: string;
    from: (title: string) => string;
    state: {
      resolved: string;
      setAside: string;
      waitingFollowUpFirst: string;
      snoozed: string;
      waitingOn: (entity: string) => string;
      waiting: string;
      comingUp: string;
      justRemembered: string;
      broughtBack: string;
      needsYou: string;
    };
    status: { resolved: string; setAside: string; waiting: string; open: string };
    problem: { somethingWentWrong: string; showingLatest: string; couldNotStart: string };
  };
  sheets: {
    done: {
      title: string;
      yes: string;
      waitingCta: string;
      waitingTitle: string;
      who: string;
      whoPlaceholder: string;
      expecting: string;
      expectingPlaceholder: string;
      defaultExpected: string;
      start: string;
    };
    edit: { title: string; save: string; cancel: string };
    snooze: { remindTitle: string; bringBackTitle: string; pickCustom: string; setCustom: string };
    whenPicker: {
      setATime: string;
      earlier: (unit: string) => string;
      later: (unit: string) => string;
      unit: { day: string; hour: string; minute: string };
    };
  };
  actions: Record<LoopAction, string> & { later: string };
  snooze: { in15Min: string; tomorrowMorning: string; thisWeekend: string; nextWeek: string };
  type: Record<LoopType, string>;
  timeline: Record<LoopEventType, string>;
  notify: {
    /** Body only — the notification title is the loop's own title. */
    task: (when: string) => string;
    waitingWithEntity: (entity: string, age: string) => Copy;
    waitingBare: (title: string, age: string) => Copy;
    /** Body only — the notification title is the loop's own title. */
    event: () => string;
    promise: (title: string, entity: string | null) => Copy;
    returnLater: (title: string) => Copy;
    softWaiting: (title: string) => Copy;
    softOther: (title: string) => Copy;
    actions: Record<NotificationActionId, string>;
  };
  service: {
    markedSeen: string;
    backToWaiting: (entity: string | null) => string;
    markedKept: string;
    gotReplyResolved: string;
    resolved: string;
    setAside: string;
    backIn15: string;
    snoozedUntil: (when: string) => string;
    stillWaitingAsk: (when: string) => string;
    stillWaitingBare: string;
    followUpAdded: string;
    turnedIntoTask: string;
    addedTaskToCheck: string;
    keeping: (n: number) => string;
    movedTo: (when: string) => string;
    nowWaiting: (title: string) => string;
    done: string;
    saved: string;
    nothingChanged: string;
  };
  format: {
    today: string;
    tomorrow: string;
    yesterday: string;
    /** Sunday-first, matching `Date#getDay()`. */
    weekdaysLong: readonly string[];
    weekdaysShort: readonly string[];
    months: readonly string[];
    partOfDay: { morning: string; afternoon: string; evening: string; today: string };
    sinceEarlierToday: string;
    sinceYesterday: string;
    forDays: (n: number) => string;
  };
  prompts: { doneSheetTitle: string; doneSheetYes: string; doneSheetWaiting: string };
}

const STRINGS: Record<UiLang, Strings> = {
  en: {
    uncertainty: {
      type: 'Not sure about the type',
      timing: 'Not sure about the timing',
      name: 'Not sure about the name',
      payday: 'I don’t know your payday, so this date is a guess. Change it if it’s off.',
      suggested: 'Suggested time — change it if it doesn’t fit',
    },
    issue: {
      title_required: 'Give it a title',
      title_too_long: 'That title is a bit long — shorten it',
      context_too_long: 'That note is too long',
      when_required: 'Pick when this should come back',
      when_passed: 'That time has already passed — pick a later one',
    },
    field: { title: 'Title', type: 'Type', person: 'Person or company', when: 'Next review', note: 'Note', date: 'Date', time: 'Time' },
    remove: 'Remove',
    noReminder: 'Notes never send reminders',
    nothingLeft: 'Nothing left to keep.',
    fixFirst: 'A couple of things need fixing first.',
    back: 'Back',
    updates: {
      confirm: 'Confirm',
      chooseAnother: 'Choose another',
      which: 'Which one is this about?',
      skip: 'Skip',
      resolved: (title) => `${title} resolved?`,
      stillWaiting: (title) => `Still waiting on ${title}?`,
      reschedule: (title, when) => `Move ${title} to ${when}?`,
      dismiss: (title) => `Set ${title} aside?`,
      unmatched: (said) => `I couldn’t match this to anything open: “${said}”`,
      noTime: 'There’s no time to move it to',
    },
    home: {
      title: 'Open Loops',
      emptyHeading: 'Nothing is asking you to keep it in your head right now.',
      emptyBody: 'Tell me a task, something you’re waiting for, or something you want brought back later.',
      cta: 'Tell me what’s going on',
      sections: { needs_you: 'NEEDS YOU', waiting: 'WAITING', coming_up: 'COMING UP', bring_back_later: 'BRING BACK LATER' },
      summary: {
        needsYou: (n) => (n === 1 ? '1 needs you' : `${n} need you`),
        waiting: (n) => (n === 1 ? '1 is waiting' : `${n} are waiting`),
        comingUp: (n) => (n === 1 ? '1 is coming up' : `${n} are coming up`),
      },
    },
    capture: {
      title: 'What’s going on?',
      placeholder:
        'HR said they’d reply this week, I need to call the dentist tomorrow, and I want to look at that jacket again after payday…',
      cta: 'Make sense of this',
      ctaBusy: 'Finding what’s still open…',
      voiceCta: 'Speak instead — coming soon',
      nothingFoundHint: 'I couldn’t find anything still open in that. Try saying what happened, or what you’re waiting for.',
    },
    review: {
      title: 'Here’s what’s still open',
      keepCta: 'Keep track of these',
      notNowCta: 'Not now',
      nothingToReview: 'Nothing to review',
      noGuessDisclaimer: 'I didn’t guess — nothing will be saved for this.',
    },
    detail: {
      notFound: 'This loop isn’t here anymore.',
      context: 'Context',
      closesWhen: 'Closes when',
      linked: 'LINKED',
      timeline: 'TIMELINE',
      from: (title) => `From: ${title}`,
      state: {
        resolved: 'Resolved',
        setAside: 'Set aside',
        waitingFollowUpFirst: 'Waiting — your follow-up comes first',
        snoozed: 'Snoozed',
        waitingOn: (entity) => `Waiting on ${entity}`,
        waiting: 'Waiting',
        comingUp: 'Coming up',
        justRemembered: 'Just remembered',
        broughtBack: 'Brought back later',
        needsYou: 'Needs you',
      },
      status: { resolved: 'Resolved', setAside: 'Set aside', waiting: 'Waiting', open: 'Open' },
      problem: {
        somethingWentWrong: 'Something went wrong. Nothing was changed.',
        showingLatest: 'Showing the latest.',
        couldNotStart: 'Could not start that',
      },
    },
    sheets: {
      done: {
        title: 'Does this end here?',
        yes: 'Yes, done',
        waitingCta: 'I’m waiting for something',
        waitingTitle: 'What are you waiting for?',
        who: 'Who or what',
        whoPlaceholder: 'HR, the bank, Ayşe…',
        expecting: 'Expecting',
        expectingPlaceholder: 'reply, refund, a decision…',
        defaultExpected: 'reply',
        start: 'Start waiting',
      },
      edit: { title: 'Edit', save: 'Save', cancel: 'Cancel' },
      snooze: { remindTitle: 'Remind me…', bringBackTitle: 'Bring this back…', pickCustom: 'Pick a date and time', setCustom: 'Set this time' },
      whenPicker: {
        setATime: 'Set a time',
        earlier: (unit) => `Earlier ${unit}`,
        later: (unit) => `Later ${unit}`,
        unit: { day: 'day', hour: 'hour', minute: 'minute' },
      },
    },
    actions: {
      done: 'Done',
      fulfilled: 'Fulfilled',
      snooze_15: '15 min later',
      later_today: 'Later today',
      remind_later: 'Remind me later',
      bring_back_later: 'Bring back later',
      still_waiting: 'Still waiting',
      got_reply: 'Got a reply',
      follow_up: 'Follow up',
      act_now: 'Act now',
      resolve: 'Resolve',
      view: 'View',
      edit: 'Edit',
      dismiss: 'Not relevant anymore',
      later: 'Later',
    },
    snooze: { in15Min: 'In 15 minutes', tomorrowMorning: 'Tomorrow morning', thisWeekend: 'This weekend', nextWeek: 'Next week' },
    type: { task: 'TASK', waiting: 'WAITING', event: 'EVENT', promise: 'PROMISE', return_later: 'RETURN LATER', reference: 'REFERENCE' },
    timeline: {
      captured: 'Captured',
      created: 'Created',
      action_completed: 'Action completed',
      waiting_started: 'Waiting started',
      review_scheduled: 'Next review scheduled',
      still_waiting: 'Still waiting',
      reply_received: 'Got a reply',
      follow_up_created: 'Follow-up started',
      follow_up_completed: 'Follow-up done',
      snoozed: 'Reminder moved',
      rescheduled: 'Time changed',
      act_now: 'Turned into a task',
      resolved: 'Resolved',
      dismissed: 'Set aside',
      reopened: 'Brought back',
      edited: 'Edited',
    },
    notify: {
      task: (when) => `You wanted to do this ${when}.`,
      waitingWithEntity: (entity, age) => ({ title: `Still waiting for ${entity}?`, body: `You've been waiting ${age}.` }),
      waitingBare: (title, age) => ({ title: 'Still waiting?', body: `${title} — waiting ${age}.` }),
      event: () => 'This was expected around now.',
      promise: (title, entity) => ({
        title: `You said you'd ${lowerFirst(title)}.`,
        body: entity ? `You told ${entity}.` : 'A promise you made.',
      }),
      returnLater: (title) => ({ title: 'You wanted this brought back now.', body: title }),
      softWaiting: (title) => ({ title: 'Still relevant?', body: title }),
      softOther: (title) => ({ title: 'Want this brought back later?', body: title }),
      actions: {
        done: 'Done',
        fulfilled: 'Fulfilled',
        snooze_15_min: '15 min later',
        later_today: 'Later today',
        still_waiting: 'Still waiting',
        got_reply: 'Got a reply',
        follow_up: 'Follow up',
        keep_for_later: 'Keep for later',
        act_now: 'Act now',
        resolve: 'Resolve',
        view: 'View',
        later: 'Later',
      },
    },
    service: {
      markedSeen: 'Marked as seen',
      backToWaiting: (entity) => `Back to waiting${entity ? ` on ${entity}` : ''}`,
      markedKept: 'Marked as kept',
      gotReplyResolved: 'Got it — resolved',
      resolved: 'Resolved',
      setAside: 'Set aside',
      backIn15: 'Back in 15 minutes',
      snoozedUntil: (when) => `Snoozed until ${when}`,
      stillWaitingAsk: (when) => `Still waiting — I’ll ask again ${when}`,
      stillWaitingBare: 'Still waiting',
      followUpAdded: 'Follow-up added',
      turnedIntoTask: 'Turned into a task',
      addedTaskToCheck: 'Added a task to check it',
      keeping: (n) => (n === 1 ? 'Keeping track of 1 thing' : `Keeping track of ${n} things`),
      movedTo: (when) => `Moved to ${when}`,
      nowWaiting: (title) => `Now waiting: ${title}`,
      done: 'Done',
      saved: 'Saved',
      nothingChanged: 'Nothing changed',
    },
    format: {
      today: 'Today',
      tomorrow: 'Tomorrow',
      yesterday: 'Yesterday',
      weekdaysLong: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      partOfDay: { morning: 'this morning', afternoon: 'this afternoon', evening: 'this evening', today: 'today' },
      sinceEarlierToday: 'since earlier today',
      sinceYesterday: 'since yesterday',
      forDays: (n) => `for ${n} days`,
    },
    prompts: { doneSheetTitle: 'Does this end here?', doneSheetYes: 'Yes, done', doneSheetWaiting: 'I’m waiting for something' },
  },
  tr: {
    uncertainty: {
      type: 'Türden emin değilim',
      timing: 'Zamanlamadan emin değilim',
      name: 'İsimden emin değilim',
      payday: 'Maaş gününü bilmiyorum, bu tarih bir tahmin. Uymuyorsa değiştir.',
      suggested: 'Önerilen zaman — uymuyorsa değiştir',
    },
    issue: {
      title_required: 'Bir başlık yaz',
      title_too_long: 'Başlık biraz uzun — kısalt',
      context_too_long: 'Not çok uzun',
      when_required: 'Ne zaman geri gelmesini istediğini seç',
      when_passed: 'Bu zaman geçti — daha ileri bir zaman seç',
    },
    field: { title: 'Başlık', type: 'Tür', person: 'Kişi veya kurum', when: 'Sonraki kontrol', note: 'Not', date: 'Tarih', time: 'Saat' },
    remove: 'Kaldır',
    noReminder: 'Notlar hatırlatma göndermez',
    nothingLeft: 'Kaydedilecek bir şey kalmadı.',
    fixFirst: 'Önce birkaç şeyin düzeltilmesi gerekiyor.',
    back: 'Geri',
    updates: {
      confirm: 'Onayla',
      chooseAnother: 'Başka seç',
      which: 'Bu hangisiyle ilgili?',
      skip: 'Atla',
      resolved: (title) => `${title} çözüldü mü?`,
      stillWaiting: (title) => `${title} için hâlâ bekliyor musun?`,
      reschedule: (title, when) => `${title}, ${when} tarihine mi taşınsın?`,
      dismiss: (title) => `${title} bir kenara mı bırakılsın?`,
      unmatched: (said) => `Bunu açık hiçbir şeyle eşleştiremedim: “${said}”`,
      noTime: 'Taşınacak uygun bir zaman yok',
    },
    home: {
      title: 'Açık Konular',
      emptyHeading: 'Şu an aklında tutman gereken hiçbir şey yok.',
      emptyBody: 'Bana bir görevi, beklediğin bir şeyi ya da sonra hatırlamak istediğin bir şeyi anlat.',
      cta: 'Neler oluyor, anlat',
      sections: { needs_you: 'SANA KALDI', waiting: 'BEKLEMEDE', coming_up: 'YAKINDA', bring_back_later: 'SONRA BAK' },
      summary: {
        needsYou: (n) => (n === 1 ? '1 şey sana kaldı' : `${n} şey sana kaldı`),
        waiting: (n) => (n === 1 ? '1 şey beklemede' : `${n} şey beklemede`),
        comingUp: (n) => (n === 1 ? '1 şey yaklaşıyor' : `${n} şey yaklaşıyor`),
      },
    },
    capture: {
      title: 'Neler oluyor?',
      placeholder:
        'İK bu hafta dönüş yapacağını söyledi, yarın dişçiyi aramam lazım, bir de maaş gününden sonra o montu tekrar bakmak istiyorum…',
      cta: 'Bunu anlamlandır',
      ctaBusy: 'Neyin açık kaldığına bakılıyor…',
      voiceCta: 'Bunun yerine konuş — yakında',
      nothingFoundHint: 'Bunda hâlâ açık bir şey bulamadım. Ne olduğunu ya da neyi beklediğini söylemeyi dene.',
    },
    review: {
      title: 'İşte hâlâ açık olanlar',
      keepCta: 'Bunları takip et',
      notNowCta: 'Şimdi değil',
      nothingToReview: 'İncelenecek bir şey yok',
      noGuessDisclaimer: 'Tahmin yürütmedim — bunun için hiçbir şey kaydedilmeyecek.',
    },
    detail: {
      notFound: 'Bu konu artık burada değil.',
      context: 'Bağlam',
      closesWhen: 'Ne zaman kapanır',
      linked: 'BAĞLANTILI',
      timeline: 'GEÇMİŞ',
      from: (title) => `Kaynak: ${title}`,
      state: {
        resolved: 'Çözüldü',
        setAside: 'Bir kenara bırakıldı',
        waitingFollowUpFirst: 'Beklemede — önce takip işin var',
        snoozed: 'Ertelendi',
        waitingOn: (entity) => `${entity} bekleniyor`,
        waiting: 'Beklemede',
        comingUp: 'Yaklaşıyor',
        justRemembered: 'Sadece not edildi',
        broughtBack: 'Geri geldi',
        needsYou: 'Sana kaldı',
      },
      status: { resolved: 'Çözüldü', setAside: 'Bir kenara bırakıldı', waiting: 'Beklemede', open: 'Açık' },
      problem: {
        somethingWentWrong: 'Bir şeyler ters gitti. Hiçbir şey değişmedi.',
        showingLatest: 'Son hâli gösteriliyor.',
        couldNotStart: 'Bu başlatılamadı',
      },
    },
    sheets: {
      done: {
        title: 'Bu burada mı bitiyor?',
        yes: 'Evet, bitti',
        waitingCta: 'Bir şey bekliyorum',
        waitingTitle: 'Neyi bekliyorsun?',
        who: 'Kim veya ne',
        whoPlaceholder: 'İK, banka, Ayşe…',
        expecting: 'Ne bekleniyor',
        expectingPlaceholder: 'yanıt, iade, bir karar…',
        defaultExpected: 'yanıt',
        start: 'Beklemeye başla',
      },
      edit: { title: 'Düzenle', save: 'Kaydet', cancel: 'İptal' },
      snooze: { remindTitle: 'Bana hatırlat…', bringBackTitle: 'Bunu geri getir…', pickCustom: 'Bir tarih ve saat seç', setCustom: 'Bu zamanı ayarla' },
      whenPicker: {
        setATime: 'Bir zaman ayarla',
        earlier: (unit) => `Önceki ${unit}`,
        later: (unit) => `Sonraki ${unit}`,
        unit: { day: 'gün', hour: 'saat', minute: 'dakika' },
      },
    },
    actions: {
      done: 'Bitti',
      fulfilled: 'Yerine getirildi',
      snooze_15: '15 dakika sonra',
      later_today: 'Bugün daha sonra',
      remind_later: 'Sonra hatırlat',
      bring_back_later: 'Sonra geri getir',
      still_waiting: 'Hâlâ bekliyorum',
      got_reply: 'Yanıt geldi',
      follow_up: 'Takip et',
      act_now: 'Şimdi yap',
      resolve: 'Çöz',
      view: 'Gör',
      edit: 'Düzenle',
      dismiss: 'Artık geçerli değil',
      later: 'Sonra',
    },
    snooze: { in15Min: '15 dakika içinde', tomorrowMorning: 'Yarın sabah', thisWeekend: 'Bu hafta sonu', nextWeek: 'Önümüzdeki hafta' },
    type: { task: 'GÖREV', waiting: 'BEKLEMEDE', event: 'OLAY', promise: 'SÖZ', return_later: 'SONRA BAK', reference: 'REFERANS' },
    timeline: {
      captured: 'Kaydedildi',
      created: 'Oluşturuldu',
      action_completed: 'İşlem tamamlandı',
      waiting_started: 'Bekleme başladı',
      review_scheduled: 'Sonraki kontrol planlandı',
      still_waiting: 'Hâlâ bekleniyor',
      reply_received: 'Yanıt geldi',
      follow_up_created: 'Takip başlatıldı',
      follow_up_completed: 'Takip tamamlandı',
      snoozed: 'Hatırlatma ertelendi',
      rescheduled: 'Zaman değişti',
      act_now: 'Göreve dönüştürüldü',
      resolved: 'Çözüldü',
      dismissed: 'Bir kenara bırakıldı',
      reopened: 'Geri getirildi',
      edited: 'Düzenlendi',
    },
    notify: {
      task: (when) => `Bunu ${when} yapmak istemiştin.`,
      waitingWithEntity: (entity, age) => ({ title: `${entity} için hâlâ bekliyor musun?`, body: `${age} bekliyorsun.` }),
      waitingBare: (title, age) => ({ title: 'Hâlâ bekliyor musun?', body: `${title} — ${age} bekliyor.` }),
      event: () => 'Bunun şimdi olması bekleniyordu.',
      promise: (title, entity) => ({
        title: `“${title}” demiştin.`,
        body: entity ? `${entity}’a söylemiştin.` : 'Verdiğin bir söz.',
      }),
      returnLater: (title) => ({ title: 'Bunu şimdi geri getirmek istemiştin.', body: title }),
      softWaiting: (title) => ({ title: 'Hâlâ geçerli mi?', body: title }),
      softOther: (title) => ({ title: 'Bu sonra tekrar hatırlatılsın mı?', body: title }),
      actions: {
        done: 'Bitti',
        fulfilled: 'Yerine getirildi',
        snooze_15_min: '15 dakika sonra',
        later_today: 'Bugün daha sonra',
        still_waiting: 'Hâlâ bekliyorum',
        got_reply: 'Yanıt geldi',
        follow_up: 'Takip et',
        keep_for_later: 'Sonraya sakla',
        act_now: 'Şimdi yap',
        resolve: 'Çöz',
        view: 'Gör',
        later: 'Sonra',
      },
    },
    service: {
      markedSeen: 'Görüldü olarak işaretlendi',
      backToWaiting: (entity) => (entity ? `${entity} için beklemeye dönüldü` : 'Beklemeye dönüldü'),
      markedKept: 'Yerine getirildi olarak işaretlendi',
      gotReplyResolved: 'Tamamdır — çözüldü',
      resolved: 'Çözüldü',
      setAside: 'Bir kenara bırakıldı',
      backIn15: '15 dakika sonra tekrar',
      snoozedUntil: (when) => `${when} tarihine ertelendi`,
      stillWaitingAsk: (when) => `Hâlâ bekliyorsun — ${when} tekrar soracağım`,
      stillWaitingBare: 'Hâlâ bekliyorsun',
      followUpAdded: 'Takip eklendi',
      turnedIntoTask: 'Göreve dönüştürüldü',
      addedTaskToCheck: 'Kontrol etmek için bir görev eklendi',
      keeping: (n) => (n === 1 ? '1 şey takip ediliyor' : `${n} şey takip ediliyor`),
      movedTo: (when) => `${when} tarihine taşındı`,
      nowWaiting: (title) => `Şimdi bekleniyor: ${title}`,
      done: 'Bitti',
      saved: 'Kaydedildi',
      nothingChanged: 'Hiçbir şey değişmedi',
    },
    format: {
      today: 'Bugün',
      tomorrow: 'Yarın',
      yesterday: 'Dün',
      weekdaysLong: ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'],
      weekdaysShort: ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'],
      months: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
      partOfDay: { morning: 'bu sabah', afternoon: 'bu öğleden sonra', evening: 'bu akşam', today: 'bugün' },
      sinceEarlierToday: 'bugünden beri',
      sinceYesterday: 'dünden beri',
      forDays: (n) => `${n} gündür`,
    },
    prompts: { doneSheetTitle: 'Bu burada mı bitiyor?', doneSheetYes: 'Evet, bitti', doneSheetWaiting: 'Bir şey bekliyorum' },
  },
};

export const strings = (lang: UiLang = getUiLang()): Strings => STRINGS[lang];

/** The badge label for a loop type ("TASK" / "GÖREV", …). */
export const typeLabel = (type: LoopType, lang: UiLang = 'en'): string => strings(lang).type[type];

/** The message for the first blocking issue on a field, if any. */
export function issueMessage(issues: readonly Issue[] | undefined, field: Issue['field'], lang?: UiLang): string | null {
  const found = issues?.find((i) => i.field === field);
  return found ? strings(lang).issue[found.code] : null;
}
