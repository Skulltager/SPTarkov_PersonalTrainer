import { JSONSchema7 } from "json-schema";

export class healthPurchasesSchema 
{
    /* eslint-disable @typescript-eslint/naming-convention */
    public static readonly schema: JSONSchema7 = {
        type: "object",
        additionalProperties: 
        {
            type: "array",
            items: 
            {
                type: "object",
                properties: 
                {
                    headHealthPurchases: { type: "number" },
                    chestHealthPurchases: { type: "number" },
                    stomachHealthPurchases: { type: "number" },
                    leftArmHealthPurchases: { type: "number" },
                    rightArmHealthPurchases: { type: "number" },
                    leftLegHealthPurchases: { type: "number" },
                    rightLegHealthPurchases: { type: "number" },
                    weightLimitIncreasePurchases: { type: "number" }
                },
                required: ["headHealthPurchases", "chestHealthPurchases","stomachHealthPurchases","leftArmHealthPurchases","rightArmHealthPurchases","leftLegHealthPurchases","rightLegHealthPurchases", "weightLimitIncreasePurchases"]
            }
        }
    };
    /* eslint-enable @typescript-eslint/naming-convention */
}
