"use node"

import { action } from "./_generated/server"
import { v } from "convex/values"
import React from "react"
import {
    render,
    Printer,
    Text,
    Row,
    Line,
    Br,
    Cut,
    Image,
} from "react-thermal-printer"
import { Jimp } from "jimp"

// ===============================
// CONSTANTS
// ===============================

const LOGO_URL = "https://res.cloudinary.com/ntlaloe-org/image/upload/w_384,f_png/v1782201264/TD_Holdings_mm9zfc.png"
const LOGO_MAX_WIDTH = 240
const PRINT_SERVER_URL = "https://smell-outplayed-hypnotic.ngrok-free.dev/api/print"

// ===============================
// HELPERS
// ===============================

function formatCurrency(amount: number) {
    return `R${amount.toFixed(2)}`
}

function isTyreDepartment(departmentName: string) {
    return departmentName?.toLowerCase().includes("tyre") ?? false
}

function hasTyreItems(items: ReceiptItem[]): boolean {
    return items.some(item => isTyreDepartment(item.departmentName))
}

async function nodeImageReader(src: string): Promise<{
    data: Uint8Array
    width: number
    height: number
}> {
    const response = await fetch(src)
    if (!response.ok) {
        throw new Error(`Failed to fetch logo: ${response.status} ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const inputBuffer = Buffer.from(arrayBuffer)
    const image = await Jimp.read(inputBuffer)

    if (image.width > LOGO_MAX_WIDTH) {
        image.resize({ w: LOGO_MAX_WIDTH })
    }

    return {
        data: new Uint8Array(image.bitmap.data),
        width: image.bitmap.width,
        height: image.bitmap.height,
    }
}

/**
 * Truncates a name to show only the first part (before space or comma)
 * Examples:
 * - "John Doe" -> "John"
 * - "Jane Smith, Manager" -> "Jane"
 * - "Dr. Michael Johnson" -> "Dr. Michael"
 */
function getShortName(fullName: string): string {
    if (!fullName) return ''

    // Remove any titles/roles after comma
    const nameWithoutTitle = fullName.split(',')[0].trim()

    // Take first name (before first space)
    const nameParts = nameWithoutTitle.split(' ')

    // If there's a title like "Dr." or "Mr.", include it with the first name
    if (nameParts.length > 1 && nameParts[0].endsWith('.')) {
        return `${nameParts[0]} ${nameParts[1]}`
    }

    // Otherwise just return the first part (usually the first name)
    return nameParts[0] || fullName
}

// ===============================
// TYPES
// ===============================

type ReceiptItem = {
    productId: string
    name: string
    sku: string
    size?: string
    color?: string
    variant?: string
    unitPrice: number
    quantity: number
    availableQuantity: number
    departmentId: string
    departmentName: string
}

type SaleDiscount = {
    productId: string
    discountAmount: number
    reason?: string
}

// ===============================
// ACTION
// ===============================

export const printReceipt = action({
    args: {
        saleId: v.string(),
        storeName: v.string(),
        storePhone: v.optional(v.string()),
        storeAddress: v.optional(v.string()),
        customerName: v.optional(v.string()),
        cashierName: v.optional(v.string()),
        paymentMethod: v.string(),
        amountReceived: v.optional(v.number()),
        changeDue: v.optional(v.number()),
        items: v.array(
            v.object({
                productId: v.string(),
                name: v.string(),
                sku: v.string(),
                size: v.optional(v.string()),
                color: v.optional(v.string()),
                variant: v.optional(v.string()),
                unitPrice: v.number(),
                quantity: v.number(),
                availableQuantity: v.number(),
                departmentId: v.string(),
                departmentName: v.string(),
            })
        ),
        // Discount rows from saleDiscounts — written by createSale,
        // passed in by the frontend after the sale completes.
        discounts: v.array(
            v.object({
                productId: v.string(),
                discountAmount: v.number(),
                reason: v.optional(v.string()),
            })
        ),
        total: v.number(),
        itemCount: v.number(),
        completedAt: v.number(),
    },

    handler: async (ctx, args) => {
        const children: React.ReactNode[] = []

        const items = args.items as ReceiptItem[]
        const discounts = args.discounts as SaleDiscount[]
        const hasTyre = hasTyreItems(items)

        // Build a quick lookup: productId -> discountAmount
        const discountByProduct: Record<string, number> = {}
        for (const d of discounts) {
            discountByProduct[d.productId] = d.discountAmount
        }

        const totalDiscount = discounts.reduce((sum, d) => sum + d.discountAmount, 0)

        // ── Header name: store for tyre sales, department otherwise ───────
        let headerName: string
        let headerLabel: string

        if (hasTyre) {
            headerName = args.storeName.toUpperCase()
            headerLabel = "STORE"
        } else {
            const departmentNames = new Set(items.map(item => item.departmentName))
            headerName = Array.from(departmentNames).join(", ").toUpperCase()
            headerLabel = "DEPARTMENT"
        }

        // ── LOGO ──────────────────────────────────────────────────────────
        try {
            children.push(
                React.createElement(Image, {
                    align: "center",
                    src: LOGO_URL,
                    reader: async () => nodeImageReader(LOGO_URL),
                })
            )
            children.push(React.createElement(Br, null))
        } catch (error) {
            console.warn("Failed to load logo:", error)
        }

        // ── HEADER ────────────────────────────────────────────────────────
        children.push(
            React.createElement(
                Text,
                { align: "center", size: { width: 2, height: 2 } },
                headerName
            )
        )
        children.push(
            React.createElement(Text, { align: "center" }, `${headerLabel} RECEIPT`)
        )
        if (args.storeAddress) {
            children.push(
                React.createElement(Text, { align: "center" }, args.storeAddress)
            )
        }
        if (args.storePhone) {
            children.push(
                React.createElement(Text, { align: "center" }, `Tel: ${args.storePhone}`)
            )
        }
        children.push(React.createElement(Line, { character: "=" }))
        children.push(React.createElement(Br, null))

        // ── DATE & TRANSACTION ID ─────────────────────────────────────────
        children.push(
            React.createElement(
                Text,
                { align: "center" },
                new Date(args.completedAt).toLocaleString("en-ZA")
            )
        )
        children.push(
            React.createElement(
                Text,
                { align: "center" },
                `Transaction ID: ${args.saleId.slice(-8)}`
            )
        )
        children.push(React.createElement(Br, null))
        children.push(React.createElement(Line, null))
        children.push(React.createElement(Br, null))

        // ── TRANSACTION DETAILS ───────────────────────────────────────────
        children.push(
            React.createElement(Text, { align: "center" }, "TRANSACTION DETAILS")
        )
        children.push(React.createElement(Br, null))

        // Show cashier with truncated name (first name only)
        if (args.cashierName) {
            const shortCashierName = getShortName(args.cashierName)
            children.push(React.createElement(Text, null, `Cashier: ${shortCashierName}`))
        }

        // Show customer with truncated name (first name only)
        if (args.customerName) {
            const shortCustomerName = getShortName(args.customerName)
            children.push(React.createElement(Text, null, `Customer: ${shortCustomerName}`))
        }

        children.push(React.createElement(Text, null, `Payment: ${args.paymentMethod}`))

        if (args.paymentMethod === "Cash" && args.amountReceived !== undefined) {
            children.push(
                React.createElement(Text, null, `Amount Received: ${formatCurrency(args.amountReceived)}`)
            )
            if (args.changeDue !== undefined && args.changeDue > 0) {
                children.push(
                    React.createElement(Text, null, `Change Due: ${formatCurrency(args.changeDue)}`)
                )
            }
        }

        children.push(React.createElement(Br, null))
        children.push(React.createElement(Line, null))

        // ── ITEMS LIST ────────────────────────────────────────────────────
        children.push(
            React.createElement(Text, { align: "center" }, "ITEMS PURCHASED")
        )
        children.push(React.createElement(Br, null))

        for (const line of items) {
            const optionLabel = [line.size, line.color, line.variant]
                .filter(Boolean)
                .join(" / ")
            const itemName = `${line.name}${optionLabel ? ` (${optionLabel})` : ""}`
            const lineTotal = line.unitPrice * line.quantity

            // Discount is stored per product (flat amount). Distribute it
            // proportionally across lines that share the same productId,
            // in case the same product appears as multiple cart lines
            // (e.g. different sizes/colors).
            let lineDiscount = 0
            const productDiscount = discountByProduct[line.productId]
            if (productDiscount !== undefined) {
                const totalQtyForProduct = items
                    .filter(i => i.productId === line.productId)
                    .reduce((sum, i) => sum + i.quantity, 0)
                lineDiscount = (productDiscount * line.quantity) / totalQtyForProduct
            }

            children.push(
                React.createElement(Text, null, itemName.substring(0, 32).toUpperCase())
            )
            children.push(
                React.createElement(Row, {
                    left: `${line.quantity} x ${formatCurrency(line.unitPrice)}`,
                    right: formatCurrency(lineTotal),
                })
            )
            if (lineDiscount > 0) {
                children.push(
                    React.createElement(Row, {
                        left: `  Discount:`,
                        right: `-${formatCurrency(lineDiscount)}`,
                    })
                )
            }
            children.push(React.createElement(Br, null))
        }

        // ── TOTALS ────────────────────────────────────────────────────────
        children.push(React.createElement(Line, null))
        children.push(React.createElement(Br, null))
        children.push(
            React.createElement(Text, { align: "center", bold: true }, "TOTALS")
        )
        children.push(React.createElement(Br, null))

        children.push(
            React.createElement(Row, {
                left: "Item Count:",
                right: args.itemCount.toString(),
            })
        )

        const subtotal = args.total + totalDiscount
        children.push(
            React.createElement(Row, {
                left: "Subtotal:",
                right: formatCurrency(subtotal),
            })
        )

        if (totalDiscount > 0) {
            children.push(
                React.createElement(Row, {
                    left: "Total Discounts:",
                    right: `-${formatCurrency(totalDiscount)}`,
                })
            )
        }

        children.push(
            React.createElement(Row, {
                left: "TOTAL AMOUNT:",
                right: formatCurrency(args.total),
            })
        )

        children.push(React.createElement(Br, null))
        children.push(React.createElement(Line, null))
        children.push(
            React.createElement(
                Text,
                { align: "center" },
                `PAYMENT: ${args.paymentMethod}`
            )
        )

        if (args.paymentMethod === "Cash" && args.amountReceived !== undefined) {
            children.push(
                React.createElement(
                    Text,
                    { align: "center" },
                    `Received: ${formatCurrency(args.amountReceived)}`
                )
            )
            if (args.changeDue !== undefined && args.changeDue > 0) {
                children.push(
                    React.createElement(
                        Text,
                        { align: "center" },
                        `Change: ${formatCurrency(args.changeDue)}`
                    )
                )
            }
        }

        children.push(React.createElement(Br, null))
        children.push(React.createElement(Line, null))

        // ── FOOTER ────────────────────────────────────────────────────────
        children.push(React.createElement(Br, null))
        children.push(
            React.createElement(Text, { align: "center" }, "THANK YOU FOR SHOPPING WITH US")
        )
        children.push(
            React.createElement(Text, { align: "center" }, "Quality • Service • Trust")
        )
        children.push(React.createElement(Br, null))
        children.push(
            React.createElement(
                Text,
                { align: "center" },
                "Please keep this receipt for returns/exchanges"
            )
        )
        children.push(React.createElement(Br, null))
        children.push(React.createElement(Cut, null))

        // ── RENDER & SEND ─────────────────────────────────────────────────
        const receipt = React.createElement(Printer, {
            type: "epson" as const,
            width: 42,
            characterSet: "korea" as const,
            children,
        })

        try {
            const data = await render(receipt)

            const response = await fetch(PRINT_SERVER_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    // Free-tier ngrok tunnels serve an HTML interstitial warning
                    // page to any request missing this header, instead of
                    // proxying through to the local print server. Without it,
                    // response.json() below fails on the HTML page.
                    "ngrok-skip-browser-warning": "true",
                },
                body: JSON.stringify({
                    receiptData: Array.from(data),
                    paymentMethod: args.paymentMethod,
                }),
            })

            if (!response.ok) {
                const text = await response.text()
                throw new Error(
                    `Print server returned ${response.status}: ${text.slice(0, 200)}`
                )
            }

            const contentType = response.headers.get("content-type") || ""
            if (!contentType.includes("application/json")) {
                const text = await response.text()
                throw new Error(`Expected JSON from print server, got: ${text.slice(0, 200)}`)
            }

            const result = await response.json()
            if (!result.success) throw new Error(result.error || "Failed to print")

            return { success: true, message: "Receipt printed successfully" }
        } catch (error) {
            console.error("Print error:", error)
            return {
                success: false,
                error: error instanceof Error ? error.message : "Unknown error occurred",
            }
        }
    },
})