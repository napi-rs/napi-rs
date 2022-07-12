use std::cmp::{Ordering, PartialOrd};
use std::collections::HashMap;
use std::fmt::Write as _;

use once_cell::sync::Lazy;

#[allow(non_snake_case, dead_code)]
pub mod NapiVersion {
  pub type NapiVersion = u8;
  pub const NAPI1: u8 = 1;
  pub const NAPI2: u8 = 2;
  pub const NAPI3: u8 = 3;
  pub const NAPI4: u8 = 4;
  pub const NAPI5: u8 = 5;
  pub const NAPI6: u8 = 6;
  pub const NAPI7: u8 = 7;
  pub const NAPI8: u8 = 8;
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct NodeVersion {
  pub major: u8,
  pub minor: u8,
  pub patch: u8,
}

impl PartialOrd for NodeVersion {
  fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
    match self.major.partial_cmp(&other.major) {
      Some(Ordering::Equal) => {}
      ord => return ord,
    }
    match self.minor.partial_cmp(&other.minor) {
      Some(Ordering::Equal) => {}
      ord => return ord,
    }
    self.patch.partial_cmp(&other.patch)
  }
}

impl NodeVersion {
  pub fn to_engine_requirement(versions: &[NodeVersion]) -> String {
    let mut requirements = vec![];
    versions.iter().enumerate().for_each(|(i, v)| {
      let mut req = String::from("");
      if i != 0 {
        let last_version = &versions[i - 1];
        let _ = write!(req, "< {}", last_version.major + 1);
      }

      let _ = write!(
        req,
        "{}>= {}.{}.{}",
        if i == 0 { "" } else { " || " },
        v.major,
        v.minor,
        v.patch
      );
      requirements.push(req);
    });

    requirements.join(" && ")
  }

  #[allow(dead_code, unused_variables)]
  pub fn verify(&self, versions: &[NodeVersion]) -> bool {
    unimplemented!()
  }
}

impl From<&str> for NodeVersion {
  fn from(s: &str) -> Self {
    let mut parts = s.trim().split('.');
    let major = parts.next().unwrap().parse().unwrap();
    let minor = parts.next().unwrap().parse().unwrap();
    let patch = parts.next().unwrap().parse().unwrap();

    NodeVersion {
      major,
      minor,
      patch,
    }
  }
}

/// because node support new napi version in some minor version updates, so we might meet such situation:
/// `node v10.20.0` supports `napi5` and `napi6`, but `node v12.0.0` only support `napi4`,
/// by which, we can not tell directly napi version supportness from node version directly.
static NAPI_VERSION_MATRIX: Lazy<HashMap<NapiVersion::NapiVersion, &'static str>> =
  Lazy::new(|| {
    HashMap::<NapiVersion::NapiVersion, &'static str>::from([
      (1_u8, "8.6.0"),
      (2_u8, "8.10.0 | 9.3.0"),
      (3_u8, "6.14.2 | 8.11.2 | 9.11.0"),
      (4_u8, "10.16.0 | 11.8.0"),
      (5_u8, "10.17.0 | 12.11.0"),
      (6_u8, "10.20.0 | 12.17.0 | 14.0.0"),
      (7_u8, "10.23.0 | 12.19.0 | 14.12.0"),
      (8_u8, "12.22.0 | 14.17.0 | 15.12.0"),
    ])
  });

fn required_node_versions(napi_version: NapiVersion::NapiVersion) -> Vec<NodeVersion> {
  match NAPI_VERSION_MATRIX.get(&napi_version) {
    Some(requirement) => {
      return requirement
        .split('|')
        .map(NodeVersion::from)
        .collect::<Vec<_>>();
    }
    None => vec![NodeVersion::from("10.0.0")],
  }
}

pub fn napi_engine_requirement(napi_version: NapiVersion::NapiVersion) -> String {
  NodeVersion::to_engine_requirement(&required_node_versions(napi_version))
}

#[cfg(test)]
mod test {
  use super::napi_engine_requirement;

  #[test]
  fn should_generate_correct_napi_engine_requirement() {
    assert_eq!(
      napi_engine_requirement(super::NapiVersion::NAPI1),
      ">= 8.6.0"
    );
    assert_eq!(
      napi_engine_requirement(super::NapiVersion::NAPI2),
      ">= 8.10.0 && < 9 || >= 9.3.0"
    );
    assert_eq!(
      napi_engine_requirement(super::NapiVersion::NAPI3),
      ">= 6.14.2 && < 7 || >= 8.11.2 && < 9 || >= 9.11.0"
    );
    assert_eq!(
      napi_engine_requirement(super::NapiVersion::NAPI4),
      ">= 10.16.0 && < 11 || >= 11.8.0"
    );
    assert_eq!(
      napi_engine_requirement(super::NapiVersion::NAPI5),
      ">= 10.17.0 && < 11 || >= 12.11.0"
    );
    assert_eq!(
      napi_engine_requirement(super::NapiVersion::NAPI6),
      ">= 10.20.0 && < 11 || >= 12.17.0 && < 13 || >= 14.0.0"
    );
    assert_eq!(
      napi_engine_requirement(super::NapiVersion::NAPI7),
      ">= 10.23.0 && < 11 || >= 12.19.0 && < 13 || >= 14.12.0"
    );
    assert_eq!(
      napi_engine_requirement(super::NapiVersion::NAPI8),
      ">= 12.22.0 && < 13 || >= 14.17.0 && < 15 || >= 15.12.0"
    );
  }
}
