import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Общи условия - Egg Origin",
  description: "Общи условия за ползване на уебсайта и услугите на Egg Origin.",
}

export default function TermsPage() {
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
  const companyMol = process.env.SELLER_MOL || "[управител]"

  return (
    <div className="bg-background py-16 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-3xl px-6 lg:px-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
          Правна информация
        </p>
        <h1 className="mt-6 text-3xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-4xl">Общи условия</h1>
        <p className="mt-6 text-sm leading-7 text-muted-foreground">Последна актуализация: Април 2026</p>

        <div className="mt-8 space-y-8 text-muted-foreground">
          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">1. Данни за продавача</h2>
            <div className="mt-4 space-y-4">
              <p>
                Уеб сайтът eggorigin.com е електронен магазин, собственост на:
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Наименование: {companyName}</li>
                <li>ЕИК: {companyEik}</li>
                <li>Седалище и адрес на управление: {companyAddress}</li>
                <li>Представлявано от: {companyMol}</li>
                <li>Имейл: info@eggorigin.com</li>
                <li>Телефон: {companyPhone}</li>
              </ul>
              <p>
                {companyName} не е регистрирано по ДДС.
              </p>
              <p>
                Настоящите Общи условия уреждат отношенията между {companyName} (наричано
                по-долу &quot;Продавач&quot;) и потребителите на уебсайта eggorigin.com (наричани
                по-долу &quot;Купувач&quot;) във връзка с покупката на продукти чрез електронния магазин.
                Използвайки този уеб сайт, вие се съгласявате с настоящите Общи условия.
                В случай че не сте съгласни с тях, не следва да използвате този уеб сайт.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">2. Надзорни органи</h2>
            <div className="mt-4 space-y-4">
              <p>
                <strong className="text-foreground">Комисия за защита на потребителите (КЗП)</strong>
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Адрес: гр. София 1000, ул. &bdquo;Врабча&ldquo; № 1, ет. 3, 4 и 5</li>
                <li>Телефон: 02/933 0565</li>
                <li>Гореща линия: 0700 111 22</li>
                <li>Уебсайт: kzp.bg</li>
              </ul>
              <p>
                <strong className="text-foreground">Комисия за защита на личните данни (КЗЛД)</strong>
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Адрес: гр. София 1592, бул. &bdquo;Проф. Цветан Лазаров&ldquo; 2</li>
                <li>Уебсайт: kzld.bg</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">3. Поръчки</h2>
            <div className="mt-4 space-y-4">
              <p>
                Поръчки се приемат по всяко време — 24 часа, 7 дни в седмицата.
                Поръчките се правят чрез уебсайта eggorigin.com без регистрация на профил.
                След завършване на поръчката Купувачът получава имейл с потвърждение,
                съдържащ детайли за поръчката.
              </p>
              <p>
                Договорът за продажба от разстояние се счита за сключен от момента на
                потвърждаване на поръчката — при картово плащане след успешно обработване
                на плащането, при наложен платеж след приемане на поръчката от Продавача.
                Договорът се сключва на български език и се съхранява в базата данни
                на уеб сайта.
              </p>
              <p>
                Продавачът си запазва правото да откаже поръчка в случай на:
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Изчерпване на наличностите</li>
                <li>Грешка в цената на продукта</li>
                <li>Невъзможност за връзка с Купувача</li>
                <li>Подозрение за измамна транзакция</li>
              </ul>
              <p>
                В случай че поръчана стока не е налична, Продавачът уведомява Купувача
                в срок до 3 работни дни. Ако е извършено плащане, сумата се възстановява
                в срок до 14 дни.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">4. Цени и плащане</h2>
            <div className="mt-4 space-y-4">
              <p>
                Всички цени са в евро (EUR) и са крайни. Цената на доставката и
                всички допълнителни такси се показват отделно преди финализиране на поръчката
                и не са включени в цената на стоката.
              </p>
              <p>
                Приемаме следните начини на плащане:
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong className="text-foreground">Банкова карта</strong> (Visa, Mastercard) —
                  плащането се обработва чрез защитената платформа Stripe, сертифицирана по PCI DSS
                  стандарт. Egg Origin не съхранява данни за банкови карти.
                </li>
                <li>
                  <strong className="text-foreground">Наложен платеж</strong> (пощенски паричен
                  превод) — плащане в брой при получаване на пратката чрез куриера. При избор на
                  наложен платеж се начислява допълнителна такса от 2,00&nbsp;€.
                </li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">5. Доставка</h2>
            <div className="mt-4 space-y-4">
              <p>
                Доставката се извършва на територията на Република България
                чрез куриерски фирми <strong className="text-foreground">Speedy</strong> и <strong className="text-foreground">Еконт</strong> до
                офис на куриер или до адрес на Купувача.
              </p>
              <p>
                Цена на доставката:
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>До офис на куриер: 3,00&nbsp;€</li>
                <li>До адрес: 3,60&nbsp;€</li>
                <li>Безплатна доставка до офис на куриер при поръчки над 30&nbsp;€</li>
              </ul>
              <p>
                Очакваният срок за доставка е до 2 работни дни след потвърждаване на
                поръчката. Продавачът не носи отговорност за забавяния, причинени от
                куриерската фирма.
              </p>
              <p>
                Купувачът се задължава да прегледа стоката в момента на доставката.
                При получаване на повредена пратка Купувачът има право да откаже
                доставката пред куриера.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">6. Фактури</h2>
            <div className="mt-4 space-y-4">
              <p>
                При оформяне на поръчката Купувачът може да заяви издаване на фактура,
                като предостави необходимите данни (за физическо лице: ЕГН, име и адрес;
                за юридическо лице: наименование, ЕИК, ДДС номер, МОЛ и адрес по регистрация).
              </p>
              <p>
                Фактурата се издава в срок до 5 дни от данъчното събитие съгласно ЗДДС —
                при картово плащане от датата на плащането, при наложен платеж от датата
                на доставката.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">7. Право на отказ</h2>
            <div className="mt-4 space-y-4">
              <p>
                Съгласно чл. 50 от Закона за защита на потребителите (ЗЗП), Купувачът има
                право да се откаже от договора от разстояние в срок от 14 дни от получаването
                на стоката, без да посочва причина, без да дължи обезщетение или неустойка
                и без да заплаща каквито и да е разходи, с изключение на разходите за
                връщането на стоката.
              </p>
              <p>
                <strong className="text-foreground">Изключение:</strong> Съгласно чл. 57, ал. 1, т. 4
                от ЗЗП, правото на отказ <strong className="text-foreground">не се прилага</strong> за
                доставка на стоки, които поради своето естество могат да влошат качеството
                си или имат кратък срок на годност. Това включва всички хранителни продукти,
                предлагани чрез уеб сайта eggorigin.com — протеинови барове и други храни.
                За такива стоки отказ от договора и връщане не се допуска, освен в случаите
                на рекламация при установено несъответствие на стоката.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">8. Възстановяване на заплатена сума</h2>
            <div className="mt-4 space-y-4">
              <p>
                В случаите, когато възстановяване на заплатена сума е дължимо (отказ
                от договор за стоки извън изключението по раздел 7, одобрена рекламация,
                недоставена стока), Продавачът възстановява всички получени плащания,
                включително разходите за доставка (с изключение на допълнителни разходи
                при избран от Купувача начин на доставка, различен от най-евтиния стандартен),
                без неоправдано забавяне и не по-късно от 14 дни от датата, на която
                Продавачът е бил уведомен за решението на Купувача.
              </p>
              <p>
                Възстановяването се извършва чрез същото платежно средство, използвано
                при първоначалната трансакция, освен ако Купувачът изрично не се съгласи
                за друг начин. Продавачът има право да отложи възстановяването до
                получаване на стоките обратно или до представяне на доказателство за
                изпращането им.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">9. Рекламации</h2>
            <div className="mt-4 space-y-4">
              <p>
                При получаване на дефектен, повреден или несъответстващ на поръчката продукт,
                Купувачът има право да предяви рекламация в срок от 14 дни от получаването.
                Рекламациите се подават на info@eggorigin.com или на телефон {companyPhone},
                с описание на проблема и прикачени снимки на повредата.
              </p>
              <p>
                Продавачът поддържа регистър на предявените рекламации. При предявяване
                на рекламация Продавачът издава документ, съдържащ датата, номера на
                рекламацията и описание на проблема.
              </p>
              <p>
                Продавачът разглежда рекламацията и уведомява Купувача за решението си в
                срок до 14 дни от получаването. При одобрена рекламация Купувачът може
                да избере замяна на стоката или възстановяване на заплатената сума.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">10. Промоционални цени</h2>
            <div className="mt-4 space-y-4">
              <p>
                При намаление на цената посочваме предишната цена, която е била прилагана
                през последните 30 дни преди намалението, съгласно изискванията на Директива
                (ЕС) 2019/2161 (Директива Омнибус).
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">11. Решаване на спорове</h2>
            <div className="mt-4 space-y-4">
              <p>
                В случай на спор относно онлайн покупка, страните ще се опитат да го
                уредят чрез преговори. При непостигане на съгласие споровете могат да
                бъдат отнесени към:
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong className="text-foreground">Помирителните комисии към КЗП</strong> —
                  орган за алтернативно решаване на потребителски спорове (kzp.bg)
                </li>
                <li>
                  <strong className="text-foreground">Европейската платформа за онлайн решаване на спорове (ОРС)</strong> —
                  достъпна на{" "}
                  <a
                    href="https://ec.europa.eu/consumers/odr"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground underline underline-offset-2 hover:text-accent"
                  >
                    ec.europa.eu/consumers/odr
                  </a>
                </li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">12. Защита на личните данни</h2>
            <p className="mt-4">
              Обработката на лични данни е описана подробно в
              нашата{" "}
              <a href="/privacy" className="text-foreground underline underline-offset-2 hover:text-accent">
                Политика за поверителност
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">13. Заключителни разпоредби</h2>
            <div className="mt-4 space-y-4">
              <p>
                Евентуалната недействителност на някоя от разпоредбите на настоящите Общи
                условия не води до недействителност на Общите условия като цяло. За всички
                неуредени въпроси се прилагат разпоредбите на действащото българско
                законодателство.
              </p>
              <p>
                Продавачът си запазва правото да актуализира настоящите Общи условия по
                всяко време. Промените влизат в сила от момента на публикуването им на
                уеб сайта.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">14. Контакт</h2>
            <div className="mt-4 space-y-4">
              <p>
                При въпроси относно тези Общи условия:
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
