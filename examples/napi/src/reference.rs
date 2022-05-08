use std::{cell::RefCell, rc::Rc};

use napi::bindgen_prelude::*;

pub struct Repository {
  dir: String,
}

impl Repository {
  fn remote(&self) -> Remote {
    Remote { inner: self }
  }
}

pub struct Remote<'repo> {
  inner: &'repo Repository,
}

impl<'repo> Remote<'repo> {
  fn name(&self) -> String {
    "origin".to_owned()
  }
}

#[napi]
pub struct JsRepo {
  inner: Repository,
}

#[napi]
impl JsRepo {
  #[napi(constructor)]
  pub fn new(dir: String) -> Self {
    JsRepo {
      inner: Repository { dir },
    }
  }

  #[napi]
  pub fn remote(&self, reference: Reference<JsRepo>, env: Env) -> Result<JsRemote> {
    Ok(JsRemote {
      inner: reference.share_with(env, |repo| Ok(repo.inner.remote()))?,
    })
  }
}

#[napi]
pub struct JsRemote {
  inner: SharedReference<JsRepo, Remote<'static>>,
}

#[napi]
impl JsRemote {
  #[napi]
  pub fn name(&self) -> String {
    self.inner.name()
  }
}

struct OwnedStyleSheet {
  rules: Vec<String>,
}

#[napi]
pub struct CSSRuleList {
  owned: Rc<RefCell<OwnedStyleSheet>>,
  parent: WeakReference<CSSStyleSheet>,
}

#[napi]
impl CSSRuleList {
  #[napi]
  pub fn get_rules(&self) -> Vec<String> {
    self.owned.borrow().rules.to_vec()
  }

  #[napi(getter)]
  pub fn parent_style_sheet(&self) -> WeakReference<CSSStyleSheet> {
    self.parent.clone()
  }

  #[napi(getter)]
  pub fn name(&self, env: Env) -> Result<Option<String>> {
    Ok(
      self
        .parent
        .upgrade(env)?
        .map(|stylesheet| stylesheet.name.clone()),
    )
  }
}

#[napi]
pub struct CSSStyleSheet {
  name: String,
  inner: Rc<RefCell<OwnedStyleSheet>>,
  rules: Option<Reference<CSSRuleList>>,
}

#[napi]
pub struct AnotherCSSStyleSheet {
  inner: Rc<RefCell<OwnedStyleSheet>>,
  rules: Reference<CSSRuleList>,
}

#[napi]
impl AnotherCSSStyleSheet {
  #[napi(getter)]
  pub fn rules(&self, env: Env) -> Result<Reference<CSSRuleList>> {
    self.rules.clone(env)
  }
}

#[napi]
impl CSSStyleSheet {
  #[napi(constructor)]
  pub fn new(name: String, rules: Vec<String>) -> Result<Self> {
    let inner = Rc::new(RefCell::new(OwnedStyleSheet { rules }));
    Ok(CSSStyleSheet {
      name,
      inner,
      rules: None,
    })
  }

  #[napi(getter)]
  pub fn rules(
    &mut self,
    env: Env,
    reference: Reference<CSSStyleSheet>,
  ) -> Result<Reference<CSSRuleList>> {
    if let Some(rules) = &self.rules {
      return rules.clone(env);
    }

    let rules = CSSRuleList::into_reference(
      CSSRuleList {
        owned: self.inner.clone(),
        parent: reference.downgrade(),
      },
      env,
    )?;

    self.rules = Some(rules.clone(env)?);
    Ok(rules)
  }

  #[napi]
  pub fn another_css_style_sheet(&self, env: Env) -> Result<AnotherCSSStyleSheet> {
    Ok(AnotherCSSStyleSheet {
      inner: self.inner.clone(),
      rules: self.rules.as_ref().unwrap().clone(env)?,
    })
  }
}
