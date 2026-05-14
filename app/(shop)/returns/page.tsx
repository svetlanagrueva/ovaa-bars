import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Право на отказ и връщане - Egg Origin",
  description:
    "Информация за правото на отказ, процедура за връщане на стоки и стандартен формуляр за упражняване на правото на отказ.",
}

export default function ReturnsPage() {
  const companyName =
    process.env.SELLER_COMPANY_NAME || "[Име на фирмата ЕООД]"
  const companyAddress =
    [
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
        <h1 className="mt-6 text-3xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-4xl">
          Право на отказ и връщане
        </h1>
        <p className="mt-6 text-sm leading-7 text-muted-foreground">
          Последна актуализация: Април 2026
        </p>

        <div className="mt-8 space-y-8 text-muted-foreground">
          {/* Section 1 */}
          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">
              1. Право на отказ от договора
            </h2>
            <div className="mt-4 space-y-4">
              <p>
                Съгласно чл. 50 от Закона за защита на потребителите (ЗЗП),
                имате право да се откажете от договора за покупка от разстояние в
                срок от{" "}
                <strong className="text-foreground">14 календарни дни</strong> от
                датата на получаване на стоката, без да посочвате причина и без
                да дължите обезщетение или неустойка.
              </p>
              <p>
                За да упражните правото си на отказ, е необходимо да ни
                уведомите с недвусмислено заявление — по имейл, писмо или чрез
                стандартния формуляр за отказ (раздел 9 по-долу).
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  Имейл:{" "}
                  <strong className="text-foreground">info@eggorigin.com</strong>
                </li>
                <li>
                  Телефон:{" "}
                  <strong className="text-foreground">{companyPhone}</strong>
                </li>
                <li>
                  Адрес:{" "}
                  <strong className="text-foreground">{companyAddress}</strong>
                </li>
              </ul>
              <p>
                Срокът за отказ се счита за спазен, ако изпратите уведомлението
                си преди изтичането на 14-дневния период.
              </p>
            </div>
          </section>

          {/* Section 2 */}
          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">
              2. Изключения от правото на отказ
            </h2>
            <div className="mt-4 space-y-4">
              <p>
                Правото на отказ не се прилага в предвидените от закона случаи,
                включително:
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  стоки, които поради своето естество могат да влошат качеството
                  си или имат кратък срок на годност (чл. 57, ал. 1, т. 4 ЗЗП);
                </li>
                <li>
                  запечатани стоки, които са разпечатани след доставката и които
                  не могат да бъдат върнати поради съображения, свързани със
                  защитата на здравето или с хигиената (чл. 57, ал. 1, т. 5
                  ЗЗП).
                </li>
              </ul>
              <p>
                За хранителни продукти като протеинови барове, правото на отказ
                на практика може да бъде упражнено, когато продуктът е неотворен
                и в оригиналната си запечатана опаковка.
              </p>
            </div>
          </section>

          {/* Section 3 */}
          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">
              3. Условия за връщане на стоката
            </h2>
            <div className="mt-4 space-y-4">
              <p>
                Когато правото на отказ е приложимо, стоката следва да бъде:
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>неотворена и с ненарушена оригинална опаковка;</li>
                <li>в оригинален търговски вид, неповредена;</li>
                <li>
                  с валиден срок на годност и в състояние, позволяващо повторна
                  продажба.
                </li>
              </ul>
              <p>
                Потребителят има право да прегледа стоката по начин, необходим за
                установяване на нейното естество, характеристики и
                функциониране, без да нарушава запечатването. Ако стойността на
                стоката е намалена в резултат на боравене, надхвърлящо
                необходимото за установяване на естеството и характеристиките й,
                продавачът може да намали пропорционално възстановяваната сума
                (чл. 55, ал. 4 ЗЗП).
              </p>
            </div>
          </section>

          {/* Section 4 */}
          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">
              4. Разходи за връщане
            </h2>
            <div className="mt-4 space-y-4">
              <p>
                При упражняване на правото на отказ преките разходи за връщане на
                стоката са за сметка на потребителя.
              </p>
              <p>
                <strong className="text-foreground">Изключение:</strong> Ако
                стоката е дефектна, сгрешена или повредена при доставка,
                разходите за връщане са за сметка на продавача.
              </p>
            </div>
          </section>

          {/* Section 5 */}
          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">
              5. Процедура за връщане
            </h2>
            <div className="mt-4 space-y-4">
              <p>
                За да върнете закупен продукт, следвайте следните стъпки:
              </p>
              <ol className="list-decimal space-y-3 pl-6">
                <li>
                  <strong className="text-foreground">
                    Изпратете уведомление за отказ
                  </strong>{" "}
                  — по имейл на info@eggorigin.com или чрез стандартния формуляр
                  (раздел 9), в рамките на 14 дни от получаване на стоката.
                </li>
                <li>
                  <strong className="text-foreground">
                    Потвърждение от продавача
                  </strong>{" "}
                  — ще потвърдим получаването на вашето уведомление.
                </li>
                <li>
                  <strong className="text-foreground">
                    Изпратете стоката обратно
                  </strong>{" "}
                  — в срок до 14 дни от изпращане на уведомлението, за ваша
                  сметка.
                </li>
                <li>
                  <strong className="text-foreground">Проверка</strong> — след
                  получаване на стоката проверяваме нейното състояние.
                </li>
                <li>
                  <strong className="text-foreground">
                    Възстановяване на сумата
                  </strong>{" "}
                  — вижте раздел 6 за подробности.
                </li>
              </ol>
            </div>
          </section>

          {/* Section 6 */}
          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">
              6. Възстановяване на сумата
            </h2>
            <div className="mt-4 space-y-4">
              <p>
                Продавачът възстановява всички получени плащания, включително
                разходите за стандартна доставка, без неоправдано забавяне и не
                по-късно от{" "}
                <strong className="text-foreground">14 дни</strong> от датата, на
                която е бил уведомен за решението на потребителя за отказ.
              </p>
              <p>
                Продавачът има право да отложи възстановяването на сумата до
                получаване на стоките обратно или до представяне на доказателство
                от потребителя за изпращането им — което от двете настъпи
                по-рано (чл. 55, ал. 5 ЗЗП).
              </p>
              <p>
                Възстановяването се извършва чрез същото платежно средство,
                използвано при първоначалната трансакция, освен ако потребителят
                изрично се съгласи за друг начин:
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong className="text-foreground">Картово плащане:</strong>{" "}
                  сумата се възстановява по картата, използвана при поръчката.
                </li>
                <li>
                  <strong className="text-foreground">
                    Наложен платеж:
                  </strong>{" "}
                  потребителят предоставя IBAN за банков превод на
                  възстановяваната сума.
                </li>
              </ul>
              <p>
                Ако потребителят е избрал начин на доставка, различен от
                най-евтиния стандартен, продавачът не е длъжен да възстанови
                допълнителните разходи.
              </p>
            </div>
          </section>

          {/* Section 7 */}
          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">
              7. Повредени или дефектни продукти
            </h2>
            <div className="mt-4 space-y-4">
              <p>
                Ако получите повреден, дефектен или несъответстващ на поръчката
                продукт, моля уведомете ни възможно най-скоро. За да ускорите
                обработката, по възможност ни уведомете в рамките на 48 часа от
                получаването, като изпратите описание на проблема и снимки на
                info@eggorigin.com.
              </p>
              <p>
                Посоченият 48-часов срок е препоръчителен и има за цел по-бързо
                разрешаване на проблема. Правата ви по законовата гаранция за
                съответствие (2 години — вижте раздел 10 от{" "}
                <a
                  href="/terms"
                  className="text-foreground underline underline-offset-2 hover:text-accent"
                >
                  Общите условия
                </a>
                ) не се засягат от този срок.
              </p>
              <p>
                При дефектни, сгрешени или повредени продукти разходите за
                връщане са за сметка на продавача. Решението —
                възстановяване на сумата или замяна — се извършва в
                съответствие със законовите права на потребителя.
              </p>
            </div>
          </section>

          {/* Section 8 */}
          <section>
            <h2 className="text-lg font-medium tracking-wide text-foreground">
              8. Рекламации и решаване на спорове
            </h2>
            <div className="mt-4 space-y-4">
              <p>
                При рекламация можете да се свържете с нас:
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  Имейл:{" "}
                  <strong className="text-foreground">info@eggorigin.com</strong>
                </li>
                <li>
                  Телефон:{" "}
                  <strong className="text-foreground">{companyPhone}</strong>
                </li>
              </ul>
              <p>
                Продавачът поддържа регистър на предявените рекламации. При
                получаване на рекламацията издаваме документ, съдържащ дата и
                номер на рекламацията.
              </p>
              <p>
                Продавачът разглежда рекламацията и уведомява потребителя за
                решението си в разумен срок.
              </p>
              <p>
                При неудовлетворителен резултат потребителят може да се обърне
                към:
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong className="text-foreground">
                    Комисия за защита на потребителите (КЗП)
                  </strong>{" "}
                  — гр. София 1000, ул. &bdquo;Врабча&ldquo; № 1, ет. 3, 4 и 5;
                  тел. 02/933 0565; горещ телефон: 0700 111 22; уебсайт:{" "}
                  <a
                    href="https://kzp.bg"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground underline underline-offset-2 hover:text-accent"
                  >
                    kzp.bg
                  </a>
                </li>
                <li>
                  <strong className="text-foreground">
                    Помирителните комисии към КЗП
                  </strong>{" "}
                  — органи за алтернативно решаване на потребителски спорове
                </li>
              </ul>
            </div>
          </section>

          {/* Section 9 */}
          <section id="withdrawal-form">
            <h2 className="text-lg font-medium tracking-wide text-foreground">
              9. Стандартен формуляр за упражняване правото на отказ
            </h2>
            <div className="mt-4 space-y-4">
              <p>
                Попълнете и изпратете настоящия формуляр единствено ако желаете
                да се откажете от договора:
              </p>

              {/* Part A: Statutory model form */}
              <div className="rounded-lg border border-border bg-secondary/30 p-6">
                <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  Стандартен формуляр за отказ (Приложение № 6 към ЗЗП)
                </p>
                <div className="space-y-3 text-sm">
                  <p>
                    До{" "}
                    <strong className="text-foreground">{companyName}</strong>,{" "}
                    {companyAddress}, имейл: info@eggorigin.com:
                  </p>
                  <p>
                    С настоящото уведомявам/уведомяваме*, че се
                    отказвам/отказваме* от сключения от мен/нас* договор за
                    покупка на следните стоки*/ за предоставяне на следната
                    услуга*:
                  </p>
                  <p>
                    _______________________________________________
                  </p>
                  <p>Поръчано на* / получено на*: _______________</p>
                  <p>Име на потребителя/ите: _______________</p>
                  <p>Адрес на потребителя/ите: _______________</p>
                  <p>
                    Подпис на потребителя/ите: _______________ (само когато
                    формулярът е на хартиен носител)
                  </p>
                  <p>Дата: _______________</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    * Ненужното се зачертава
                  </p>
                </div>
              </div>

              {/* Part B: Optional operational info */}
              <div className="rounded-lg border border-border/60 p-6">
                <p className="mb-3 text-sm font-medium text-foreground">
                  Допълнителна информация (по желание)
                </p>
                <p className="mb-3 text-sm">
                  При наложен платеж, моля посочете банкова сметка за
                  възстановяване на сумата:
                </p>
                <div className="space-y-2 text-sm">
                  <p>IBAN: _______________</p>
                  <p>BIC: _______________</p>
                  <p>Титуляр на сметката: _______________</p>
                </div>
              </div>

              <p>
                Можете да изпратите попълнения формуляр на{" "}
                <strong className="text-foreground">info@eggorigin.com</strong>{" "}
                или по пощата на адрес:{" "}
                <strong className="text-foreground">{companyAddress}</strong>.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
