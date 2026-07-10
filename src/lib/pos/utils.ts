import type { CartLine, Product } from "#/types/pos";

export function cartKey(
    productId: string,
    size?: string,
    color?: string,
    variant?: string
) {
    return `${productId}::${size ?? ""}::${color ?? ""}::${variant ?? ""}`;
}

export function resolvePrice(product: Product, size?: string) {
    if (size && product.sizePricing?.length) {
        const match = product.sizePricing.find((sp) => sp.size === size);
        if (match) return match.sellingPrice;
    }
    return product.sellingPrice;
}

export function needsVariantPicker(product: Product) {
    return (
        (product.sizes && product.sizes.length > 0) ||
        (product.colors && product.colors.length > 0) ||
        (product.variants && product.variants.length > 0)
    );
}

export function formatCurrency(amount: number) {
    return `R${amount.toFixed(2)}`;
}

const TYRE_DISCOUNT_THRESHOLD = 4;
const TYRE_DISCOUNT_AMOUNT = 200;

export function extractRimSize(sizeStr: string): number | null {
    const m =
        sizeStr.match(/[Rr](\d+)$/) ||
        sizeStr.match(/^(\d+)$/) ||
        sizeStr.match(/(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
}

export function computeFrontendDiscounts(cart: CartLine[]): number {
    const productQty: Record<string, number> = {};
    for (const line of cart) {
        if (!line.departmentName.toLowerCase().includes("tyre")) continue;
        if (!line.size) continue;
        const rim = extractRimSize(line.size);
        if (rim === null || rim < 14) continue;
        productQty[line.productId] = (productQty[line.productId] || 0) + line.quantity;
    }

    let autoDiscountTotal = 0;
    for (const qty of Object.values(productQty)) {
        if (qty >= TYRE_DISCOUNT_THRESHOLD) autoDiscountTotal += TYRE_DISCOUNT_AMOUNT;
    }

    const manualDiscountTotal = cart.reduce(
        (sum, l) => sum + (l.manualDiscount || 0),
        0
    );
    return autoDiscountTotal + manualDiscountTotal;
}

/**
 * Builds the receipt-facing discount breakdown (per product, with reasons)
 * used when finalizing a sale. Mirrors computeFrontendDiscounts but returns
 * line-item detail instead of just a total.
 */
export function buildReceiptDiscounts(cart: CartLine[]) {
    const discounts: { productId: string; discountAmount: number; reason?: string }[] = [];

    const productQty: Record<string, { qty: number; departmentName: string }> = {};
    for (const line of cart) {
        if (!line.departmentName.toLowerCase().includes("tyre")) continue;
        if (!line.size) continue;
        const rim = extractRimSize(line.size);
        if (rim === null || rim < 14) continue;
        if (!productQty[line.productId]) {
            productQty[line.productId] = { qty: 0, departmentName: line.departmentName };
        }
        productQty[line.productId].qty += line.quantity;
    }

    for (const [productId, { qty }] of Object.entries(productQty)) {
        if (qty >= TYRE_DISCOUNT_THRESHOLD) {
            discounts.push({
                productId,
                discountAmount: TYRE_DISCOUNT_AMOUNT,
                reason: `Tyre bulk discount (${qty}x, size 14+)`,
            });
        }
    }

    for (const line of cart) {
        if (line.manualDiscount && line.manualDiscount > 0) {
            discounts.push({
                productId: line.productId,
                discountAmount: line.manualDiscount,
                reason: "Manual discount",
            });
        }
    }

    return discounts;
}