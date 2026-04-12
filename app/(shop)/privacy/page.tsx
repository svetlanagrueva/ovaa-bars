import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Политика за поверителност - Egg Origin",
  description: "Политика за поверителност и защита на личните данни на Egg Origin.",
}

export default function PrivacyPage() {
  const companyName = process.env.SELLER_COMPANY_NAME || "[Име на фирмата ЕООД]"
  const companyEik = process.env.SELLER_EIK || "[ЕИК]"
  const companyAddress = [
    process.env.SELLER_ADDRESS,
    process.env.SELLER_CITY,
    process.env.SELLER_POSTAL_CODE,
  ]
    .filter(Boolean)
    .join(", ") || "[адрес на управление]"
  const companyPhone = process.env.SELLER_PHONE || "[телефон]"

  return (
    <div className="bg-background py-16 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-3xl px-6 lg:px-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
          Правна информация
        </p>
        <h1 className="mt-6 text-3xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-4xl">Политика за поверителност</h1>
        <p className="mt-6 text-sm leading-7 text-muted-foreground">Последна актуализация: Април 2026</p>

        <div className="mt-8 space-y-8 text-muted-foreground">
          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">1. Администратор на лични данни</h2>
            <div className="mt-4 space-y-4">
              <p>
                Администратор на вашите лични данни е:
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>{companyName}</li>
                <li>ЕИК: {companyEik}</li>
                <li>Седалище и адрес на управление: {companyAddress}</li>
                <li>Имейл: info@eggorigin.com</li>
                <li>Телефон: {companyPhone}</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">2. Какви данни събираме</h2>
            <div className="mt-4 space-y-4">
              <p>При правене на поръчка събираме следните данни:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Име и фамилия</li>
                <li>Имейл адрес</li>
                <li>Телефонен номер</li>
                <li>Адрес за доставка (град, адрес, пощенски код)</li>
                <li>Избран начин на плащане и доставка</li>
                <li>Бележки към поръчката (ако са предоставени)</li>
              </ul>
              <p>При заявка за фактура допълнително събираме:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>За физическо лице: ЕГН, име и адрес</li>
                <li>За юридическо лице: наименование на фирмата, ЕИК/БУЛСТАТ, ДДС номер, МОЛ и адрес по регистрация</li>
              </ul>
              <p>
                Информация за плащане с карта (номер на карта, CVV) се обработва
                директно от Stripe и не достига до нашите сървъри.
              </p>
              <p>
                При оформяне на поръчката имате възможност да изразите съгласие за
                получаване на маркетингови съобщения (промоции и новини). Това съгласие
                се записва заедно с поръчката.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">3. Цели и правно основание за обработка</h2>
            <div className="mt-4 space-y-4">
              <p>Обработваме вашите данни на следните правни основания:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong className="text-foreground">Изпълнение на договор</strong> (чл. 6, ал. 1, б. &quot;б&quot; GDPR) —
                  обработка и доставка на поръчки, комуникация относно статуса на поръчката, обработка на рекламации и връщания
                </li>
                <li>
                  <strong className="text-foreground">Законово задължение</strong> (чл. 6, ал. 1, б. &quot;в&quot; GDPR) —
                  издаване на фактури съгласно ЗДДС (включително обработка на ЕГН/ЕИК), водене на счетоводна отчетност
                  съгласно Закона за счетоводството
                </li>
                <li>
                  <strong className="text-foreground">Съгласие</strong> (чл. 6, ал. 1, б. &quot;а&quot; GDPR) —
                  изпращане на маркетингови имейли (промоции и новини), използване на аналитични бисквитки
                </li>
                <li>
                  <strong className="text-foreground">Легитимен интерес</strong> (чл. 6, ал. 1, б. &quot;е&quot; GDPR) —
                  предотвратяване на злоупотреби и измами, подобряване на сигурността на сайта
                </li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">4. Споделяне на данни с трети страни</h2>
            <div className="mt-4 space-y-4">
              <p>Споделяме вашите данни само с доставчици на услуги, необходими за дейността ни:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li><strong className="text-foreground">Stripe</strong> — обработка на картови плащания (САЩ)</li>
                <li><strong className="text-foreground">Speedy и Еконт</strong> — куриерска доставка на поръчки (България)</li>
                <li><strong className="text-foreground">Vercel</strong> — хостинг на уебсайта (САЩ)</li>
                <li><strong className="text-foreground">Supabase</strong> — съхранение на данни в база данни (ЕС)</li>
                <li><strong className="text-foreground">Resend</strong> — изпращане на имейли (потвърждения за поръчки, маркетингови съобщения) (САЩ)</li>
                <li><strong className="text-foreground">Google</strong> — уеб анализ чрез Google Analytics (САЩ) — само с ваше съгласие чрез банера за бисквитки</li>
              </ul>
              <p>
                Не продаваме и не предоставяме вашите лични данни на трети страни за
                техни собствени маркетингови цели.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">5. Предаване на данни извън ЕС</h2>
            <div className="mt-4 space-y-4">
              <p>
                Някои от нашите доставчици на услуги (Stripe, Vercel, Resend, Google) са
                установени в САЩ. Предаването на данни към тези доставчици се извършва при
                наличие на подходящи гаранции съгласно чл. 46 GDPR — стандартни договорни
                клаузи (СДК), одобрени от Европейската комисия, и/или решения за адекватност
                на защитата.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">6. Срокове за съхранение на данни</h2>
            <div className="mt-4 space-y-4">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong className="text-foreground">Данни за поръчки и фактури</strong> (включително ЕГН, ЕИК, фактурни данни) —
                  10 години от края на отчетния период, съгласно чл. 12 от Закона за счетоводството
                </li>
                <li>
                  <strong className="text-foreground">Маркетингови имейл логове</strong> — до 2 години след последния изпратен имейл
                </li>
                <li>
                  <strong className="text-foreground">Записи за отписване от маркетинг</strong> — безсрочно, за да гарантираме,
                  че няма да получавате нежелани съобщения
                </li>
                <li>
                  <strong className="text-foreground">Аналитични данни</strong> — съгласно политиките за съхранение на Google и Vercel
                </li>
              </ul>
              <p>
                След изтичане на съответния срок данните се изтриват или анонимизират.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">7. Вашите права</h2>
            <div className="mt-4 space-y-4">
              <p>Съгласно GDPR, вие имате право на:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Достъп до вашите лични данни</li>
                <li>Коригиране на неточни данни</li>
                <li>Изтриване на данни (&quot;правото да бъдеш забравен&quot;) — освен когато съхранението е
                  необходимо по закон (напр. фактурни данни по Закона за счетоводството)</li>
                <li>Ограничаване на обработката</li>
                <li>Преносимост на данните в структуриран, машинно четим формат</li>
                <li>Възражение срещу обработка, основана на легитимен интерес</li>
                <li>Оттегляне на съгласие по всяко време — без това да засяга законосъобразността
                  на обработката преди оттеглянето</li>
              </ul>
              <p>
                За да упражните тези права, свържете се с нас на info@eggorigin.com.
              </p>
              <p>
                Имате право да подадете жалба до Комисията за защита на личните данни (КЗЛД):
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Адрес: бул. &bdquo;Проф. Цветан Лазаров&ldquo; 2, София 1592</li>
                <li>Уебсайт: kzld.bg</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">8. Маркетингови съобщения</h2>
            <div className="mt-4 space-y-4">
              <p>
                При оформяне на поръчка имате възможност да се съгласите да получавате
                маркетингови имейли. Чекбоксът е <strong className="text-foreground">изключен по подразбиране</strong> —
                ще получавате маркетингови съобщения само ако изрично го включите.
              </p>
              <p>Маркетинговите имейли, които изпращаме, са:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Покана за отзив — няколко дни след доставката</li>
                <li>Препоръки за продукти — до 2 седмици след доставката</li>
              </ul>
              <p>
                Всеки маркетингов имейл съдържа линк за отписване. Можете да се отпишете
                и по имейл на info@eggorigin.com. Отписването влиза в сила незабавно.
              </p>
              <p>
                Имейлите за статуса на поръчката (потвърждение, изпращане, доставка)
                са транзакционни и не изискват маркетингово съгласие — те са необходими
                за изпълнение на договора.
              </p>
            </div>
          </section>

          <section id="cookies">
            <h2 className="text-lg font-medium tracking-wide text-foreground">9. Бисквитки и локално съхранение</h2>
            <div className="mt-4 space-y-4">
              <p>
                Нашият сайт използва бисквитки и локално съхранение (localStorage) за различни
                цели. При първото ви посещение ще бъдете помолени да дадете съгласие за
                аналитичните бисквитки.
              </p>

              <div>
                <h3 className="font-medium text-foreground">Необходими (без съгласие)</h3>
                <ul className="mt-2 list-disc space-y-2 pl-6">
                  <li>
                    <strong>Количка</strong> — съхраняваме съдържанието на количката ви в localStorage,
                    за да запазим избраните продукти между посещенията. Не съдържа лични данни.
                  </li>
                  <li>
                    <strong>Съгласие за бисквитки</strong> — запомняме вашия избор (приемане/отказ)
                    в localStorage, за да не ви питаме повторно.
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="font-medium text-foreground">Аналитични (с ваше съгласие)</h3>
                <ul className="mt-2 list-disc space-y-2 pl-6">
                  <li>
                    <strong>Vercel Analytics</strong> — използваме Vercel Analytics за анализ на
                    трафика. Тази услуга се активира само ако дадете съгласие чрез банера за
                    бисквитки. Vercel Analytics не използва бисквитки за проследяване между сайтове.
                  </li>
                  <li>
                    <strong>Google Analytics</strong> — използваме Google Analytics за детайлен анализ
                    на посещаемостта и потребителското поведение. Активира се само с ваше съгласие.
                    Google може да обработва данни в САЩ при наличие на подходящи гаранции (вж. раздел 5).
                  </li>
                </ul>
              </div>

              <p>
                Можете да оттеглите съгласието си по всяко време чрез иконата за бисквитки
                в долния ляв ъгъл на сайта или като изчистите данните на сайта от настройките
                на браузъра си.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">10. Автоматизирано вземане на решения</h2>
            <p className="mt-4">
              Не използваме автоматизирано вземане на решения или профилиране по смисъла
              на чл. 22 GDPR, което да има правни последици за вас.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">11. Задължителност на предоставянето на данни</h2>
            <div className="mt-4 space-y-4">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  Име, имейл, телефон и адрес за доставка са необходими за изпълнение на
                  поръчката (договорно изискване). Без тях не можем да обработим поръчката ви.
                </li>
                <li>
                  ЕГН/ЕИК и фактурни данни са необходими по закон (ЗДДС), ако заявите издаване
                  на фактура. Предоставянето им е законово изискване.
                </li>
                <li>
                  Маркетинговото съгласие е доброволно и не влияе върху възможността ви да
                  направите поръчка.
                </li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">12. Сигурност на данните</h2>
            <p className="mt-4">
              Прилагаме подходящи технически и организационни мерки за защита на вашите
              данни от неоторизиран достъп, загуба или унищожаване. Плащанията се обработват
              чрез защитената платформа Stripe, която е сертифицирана по PCI DSS стандарт.
              Достъпът до лични данни е ограничен до оторизирани лица.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">13. Контакт</h2>
            <div className="mt-4 space-y-4">
              <p>
                При въпроси относно тази политика или обработката на вашите данни:
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Имейл: info@eggorigin.com</li>
                <li>Телефон: {companyPhone}</li>
                <li>Адрес: {companyAddress}</li>
              </ul>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
