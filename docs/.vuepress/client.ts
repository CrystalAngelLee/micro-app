import { defineClientConfig } from '@vuepress/client'
import Layout from './theme/components/SidebarAnchor.vue'
import HomeLayout from './theme/components/Home.vue'

export default defineClientConfig({
  enhance({ app, router, siteData }) {},
  setup() {},
  layouts: {
    Layout,
    HomeLayout
  }
})
