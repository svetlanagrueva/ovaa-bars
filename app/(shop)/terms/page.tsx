import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Общи условия - Egg Origin",
  description: "Общи условия за ползване на уебсайта и услугите на Egg Origin.",
}

export default function TermsPage() {
  return (
    <div className="bg-background py-12 sm:py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Общи условия</h1>
        <p className="mt-4 text-sm text-muted-foreground">Последна актуализация: Януари 2026</p>

        <div className="mt-8 space-y-8 text-muted-foreground">
          <section>
            <h2 className="text-xl font-semibold text-foreground">1. Общи положения</h2>
            <p className="mt-4">
              Настоящите Общи условия уреждат отношенията между Egg Origin (наричан по-долу 
              &quot;Продавач&quot;) и потребителите на уебсайта eggorigin.com (наричани по-долу &quot;Купувач&quot;) 
              във връзка с покупката на продукти чрез електронния магазин.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">2. Поръчки</h2>
            <div className="mt-4 space-y-4">
              <p>
                Поръчките се правят чрез уебсайта eggorigin.com. След завършване на поръчката, 
                Купувачът получава имейл с потвърждение, съдържащ детайли за поръчката.
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
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">3. Цени и плащане</h2>
            <div className="mt-4 space-y-4">
              <p>
                Всички цени са в евро (EUR) и включват ДДС. Цената на доставката
                се показва отделно преди финализиране на поръчката.
              </p>
              <p>
                Плащането се извършва чрез банкова карта (Visa, Mastercard) посредством 
                защитената платформа Stripe.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">4. Доставка</h2>
            <div className="mt-4 space-y-4">
              <p>
                Доставката се извършва чрез куриерска фирма Speedy до офис или адрес на 
                Купувача в рамките на 2 работни дни след потвърждаване на поръчката.
              </p>
              <p>
                Цена на доставката:
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>До офис на куриер: 3,00 €</li>
                <li>До адрес: 3,60 €</li>
                <li>Безплатна доставка до офис при поръчки над 30 €</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">5. Право на отказ</h2>
            <div className="mt-4 space-y-4">
              <p>
                Съгласно Закона за защита на потребителите, Купувачът има право да се откаже 
                от договора от разстояние в срок от 14 дни от получаването на стоката, без 
                да посочва причина и без да дължи обезщетение или неустойка.
              </p>
              <p>
                За да упражни правото си на отказ, Купувачът трябва да уведоми Продавача чрез 
                имейл на info@eggorigin.com. Продуктите трябва да бъдат върнати в оригиналната 
                си опаковка, без да са отваряни или използвани.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">6. Рекламации</h2>
            <div className="mt-4 space-y-4">
              <p>
                При получаване на дефектен или повреден продукт, Купувачът има право да предяви 
                рекламация в срок от 14 дни от получаването. Рекламациите се подават на 
                info@eggorigin.com с прикачени снимки на повредата.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">7. Контакт</h2>
            <p className="mt-4">
              При въпроси относно тези Общи условия, моля свържете се с нас на:
              <br />
              Имейл: info@eggorigin.com
              <br />
              Телефон: +359 888 123 456
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
