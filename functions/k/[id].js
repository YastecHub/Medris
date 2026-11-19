import { sharePage } from "../_share.js";

export const onRequestGet = (context) => sharePage(context, { package: context.params.id });
